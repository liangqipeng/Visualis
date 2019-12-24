/*
 * <<
 * Davinci
 * ==
 * Copyright (C) 2016 - 2017 EDP
 * ==
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * >>
 */

import * as React from 'react'
import { findDOMNode } from 'react-dom'
import * as classnames from 'classnames'
import { IChartProps } from '../'
import { IChartStyles, IPaginationParams } from '../../Widget'
import { ITableHeaderConfig } from 'containers/Widget/components/Config/Table'

import { IResizeCallbackData } from 'libs/react-resizable/lib/Resizable'
import { Table as AntTable, Tooltip, Icon } from 'antd'
import { TableProps, ColumnProps, SorterResult } from 'antd/lib/table'
import { PaginationConfig } from 'antd/lib/pagination/Pagination'
import PaginationWithoutTotal from 'components/PaginationWithoutTotal'
import SearchFilterDropdown from 'components/SearchFilterDropdown/index'
import NumberFilterDropdown from 'components/NumberFilterDropdown/index'
import DateFilterDropdown from 'components/DateFilterDropdown/index'

import { TABLE_PAGE_SIZES } from 'app/globalConstants'
import { getFieldAlias } from 'containers/Widget/components/Config/Field'
import { decodeMetricName } from 'containers/Widget/components/util'
import Styles from './Table.less'
import { TOTAL_COLUMN_WIDTH } from 'app/globalConstants'

import {
  findChildConfig, traverseConfig,
  computeCellWidth, getDataColumnWidth, getMergedCellSpan, getTableCellValueRange } from './util'
import { MapAntSortOrder } from './constants'
import { FieldSortTypes } from '../../Config/Sort'
import { tableComponents } from './components'
import { resizeTableColumns } from './components/HeadCell'

interface IMapTableHeaderConfig {
  [key: string]: ITableHeaderConfig
}

interface ITableStates {
  chartStyles: IChartStyles
  data: object[]
  width: number
  pagination: IPaginationParams
  currentSorter: { column: string, direction: FieldSortTypes }

  tableColumns: Array<ColumnProps<any>>
  mapTableHeaderConfig: IMapTableHeaderConfig
  tablePagination: {
    current: number
    pageSize: number
    simple: boolean
    total: number
  }
  selectedRow: object[]
  tableBodyHeight: number
}

// 保留一个刚拖拽列宽的状态，用于下面判断是采用拖拽后的列宽值还是“表格数据设置”里配置的列宽值
let isDragged = false

export class Table extends React.PureComponent<IChartProps, ITableStates> {

  private static HeaderSorterWidth = 0

  public state: Readonly<ITableStates> = {
    chartStyles: null,
    data: null,
    width: 0,
    pagination: null,
    currentSorter: null,

    tableColumns: [],
    mapTableHeaderConfig: {},
    tablePagination: {
      current: void 0,
      pageSize: void 0,
      simple: false,
      total: void 0
    },
    tableBodyHeight: 0,
    selectedRow: []
  }

  private table = React.createRef<AntTable<any>>()

  // 通过拖拽的方式调整表格列宽时触发的事件
  private handleResize = (idx: number) => (_, { size }: IResizeCallbackData) => {
    const nextColumns = resizeTableColumns(this.state.tableColumns, idx, size.width)
    this.setState({ tableColumns: nextColumns })
    const { cols, rows, metrics, data, onSetWidgetProps, onSetWidthChangedInInput, onSetNeedUpdateDataParams, pagination, secondaryMetrics, filters, selectedChart, orders, mode, model, onPaginationChange, chartStyles } = this.props
    // tempWidgetProps是用来在onSetWidgetProps中使用的，所以只需要workbench中的原始字段
    const tempWidgetProps = { data, pagination, cols, rows, metrics, secondaryMetrics, filters, chartStyles, selectedChart, orders, mode, model, onPaginationChange }
    tempWidgetProps.cols.forEach((col, index) => {
      for (let i = 0; i < nextColumns.length; i++) {
        if (col.name === nextColumns[i].key) {
          tempWidgetProps.cols[index].width = nextColumns[i].width
          // 通过输入框里输入或拖拽改变列宽之后，widthChanged都要设为true
          tempWidgetProps.cols[index].widthChanged = true
          break
        }
      }
    })
    tempWidgetProps.metrics.forEach((metric, index) => {
      for (let i = 0; i < nextColumns.length; i++) {
        if (metric.name === nextColumns[i].key) {
          tempWidgetProps.metrics[index].width = nextColumns[i].width
          // 通过输入框里输入或拖拽改变列宽之后，widthChanged都要设为true
          tempWidgetProps.metrics[index].widthChanged = true
          break
        }
      }
    })
    // tempWidgetProps.cols = cols
    onSetNeedUpdateDataParams(true)
    onSetWidgetProps(tempWidgetProps)
    // 保留一个刚拖拽列宽的状态，用于下面判断是采用拖拽后的列宽值还是“表格数据设置”里配置的列宽值
    isDragged = true
    onSetWidthChangedInInput(false)
  }

  // 可拖拽列宽的列的配置
  private adjustTableColumns (tableColumns: Array<ColumnProps<any>>, mapTableHeaderConfig: IMapTableHeaderConfig) {
    // const totalWidth = tableColumns.reduce((acc, col) => acc + Number(col.width), 0)
    // const totalWidth = TOTAL_COLUMN_WIDTH
    // const ratio = totalWidth < containerWidth ? containerWidth / totalWidth : 1
    traverseConfig<ColumnProps<any>>(tableColumns, 'children', (column, idx, siblings) => {
      // column.width = ratio * Number(column.width)
      const canResize = siblings === tableColumns
      column.onHeaderCell = (col) => ({
        width: col.width,
        onResize: canResize && this.handleResize(idx),
        config: mapTableHeaderConfig[column.key]
      })
    })
    return tableColumns
  }

  // 分页有改动时触发的事件
  private paginationChange = (current: number, pageSize: number) => {
    const { currentSorter } = this.state
    this.refreshTable(current, pageSize, currentSorter)
  }

  // 基础的分页配置，实际使用时还会增加一些额外的分页配置
  private basePagination: PaginationConfig = {
    pageSizeOptions: TABLE_PAGE_SIZES.map((s) => s.toString()),
    showQuickJumper: true,
    showSizeChanger: true,
    showTotal: (total: number) => `共${total}条`,
    onChange: this.paginationChange,
    onShowSizeChange: this.paginationChange
  }

  // 表格有改动时触发的事件
  private tableChange = (pagination: PaginationConfig, _, sorter: SorterResult<object>) => {
    const nextCurrentSorter: ITableStates['currentSorter'] = sorter.field
      ? { column: sorter.field, direction: MapAntSortOrder[sorter.order] }
      : null
    this.setState({ currentSorter: nextCurrentSorter })
    const { current, pageSize } = pagination
    this.refreshTable(current, pageSize, nextCurrentSorter)
  }

  // 刷新表格 表格变换分页或者更改筛选后就要刷新表格
  private refreshTable = (current: number, pageSize: number, sorter?: ITableStates['currentSorter']) => {
    const { tablePagination } = this.state
    if (pageSize !== tablePagination.pageSize) {
      current = 1
    }
    const { onPaginationChange } = this.props
    onPaginationChange(current, pageSize, sorter)
  }

  public componentDidMount () {
    const { headerFixed, withPaging } = this.props.chartStyles.table
    this.adjustTableCell(headerFixed, withPaging)
  }

  public componentDidUpdate () {
    const { headerFixed, withPaging } = this.props.chartStyles.table
    this.adjustTableCell(headerFixed, withPaging, this.state.tablePagination.total)
  }

  private adjustTableCell (headerFixed: boolean, withPaging: boolean, dataTotal?: number) {
    const tableDom = findDOMNode(this.table.current) as Element
    const excludeElems = []
    let paginationMargin = 0
    let paginationWithoutTotalHeight = 0
    if (headerFixed) {
      excludeElems.push('.ant-table-thead')
    }
    if (withPaging) {
      excludeElems.push('.ant-pagination.ant-table-pagination')
      paginationMargin = 32

      if (dataTotal === -1) {
        paginationWithoutTotalHeight = 45
      }
    }
    const excludeElemsHeight = excludeElems.reduce((acc, exp) => {
      const elem = tableDom.querySelector(exp)
      return acc + (elem ? elem.getBoundingClientRect().height : 0)
    }, paginationMargin)
    const tableBodyHeight = this.props.height - excludeElemsHeight - paginationWithoutTotalHeight
    this.setState({
      tableBodyHeight
    })
  }

  // 将传入的props映射到state上
  public static getDerivedStateFromProps (nextProps: IChartProps, prevState: ITableStates) {
    const { chartStyles, data } = nextProps
    if (chartStyles !== prevState.chartStyles || data !== prevState.data) {
      const { tableColumns, mapTableHeaderConfig } = getTableColumns(nextProps)
      const tablePagination = getPaginationOptions(nextProps)
      return { tableColumns, mapTableHeaderConfig, tablePagination, chartStyles, data }
    }
    return { chartStyles, data }
  }

  // 获取行的key值
  private getRowKey = (record: object, idx: number) => {
    return Object.values(record).join('_' + idx)
  }

  // 获取表格的 scroll项的配置
  private getTableScroll (
    columns: Array<ColumnProps<any>>,
    containerWidth: number,
    headerFixed: boolean,
    tableBodyHeght: number
  ) {
    const scroll: TableProps<any>['scroll'] = {}
    const columnsTotalWidth = columns.reduce((acc, c) => acc + (c.width as number), 0)
    if (columnsTotalWidth > containerWidth) {
      scroll.x = Math.max(columnsTotalWidth, containerWidth)
    }
    if (headerFixed) {
      scroll.y = tableBodyHeght
    }
    return scroll
  }

  // 获取表格的样式
  private getTableStyle (
    headerFixed: boolean,
    tableBodyHeght: number
  ) {
    const tableStyle: React.CSSProperties = { }
    if (!headerFixed) {
      tableStyle.height = tableBodyHeght
      tableStyle.overflowY = 'scroll'
    }
    return tableStyle
  }

  private isSameObj (
    prevObj: object,
    nextObj: object,
    isSourceData?: boolean
  ): boolean {
    let isb = void 0
    const clonePrevObj = {...prevObj}
    const cloneNextObj = {...nextObj}
    if (isSourceData === true) {
      delete clonePrevObj['key']
      delete clonePrevObj['value']
      delete cloneNextObj['key']
      delete cloneNextObj['value']
    }
    for (const attr in clonePrevObj) {
      if (clonePrevObj[attr] !== undefined && clonePrevObj[attr] === cloneNextObj[attr]) {
        isb = true
      } else {
        isb = false
        break
      }
    }
    return isb
  }

  // 表格每行的点击事件
  private rowClick = (record, row, event) => {
    const { getDataDrillDetail, onCheckTableInteract, onDoInteract } = this.props
    let selectedRow = [...this.state.selectedRow]
    let filterObj = void 0
    if (event.target && event.target.innerHTML) {
      for (const attr in record) {
        if (record[attr].toString() === event.target.innerText) {
          const re = /\(\S+\)/
          const key = re.test(attr) ? attr.match(/\((\S+)\)/)[1] : attr
          filterObj = {
            key,
            value: event.target.innerText
          }
        }
      }
    }
    const recordConcatFilter = {
      ...record,
      ...filterObj
    }
    const isInteractiveChart = onCheckTableInteract && onCheckTableInteract()
    if (isInteractiveChart && onDoInteract) {
      selectedRow = [recordConcatFilter]
    } else {
      if (selectedRow.length === 0) {
        selectedRow.push(recordConcatFilter)
      } else {
        const isb = selectedRow.some((sr) => this.isSameObj(sr, recordConcatFilter, true))
        if (isb) {
          for (let index = 0, l = selectedRow.length; index < l; index++) {
              if (this.isSameObj(selectedRow[index], recordConcatFilter, true)) {
                selectedRow.splice(index, 1)
                break
              }
          }
        } else  {
          selectedRow.push(recordConcatFilter)
        }
      }
    }

    this.setState({
      selectedRow
    }, () => {
      const brushed = [{0: Object.values(this.state.selectedRow)}]
      const sourceData = Object.values(this.state.selectedRow)
      const isInteractiveChart = onCheckTableInteract && onCheckTableInteract()
      if (isInteractiveChart && onDoInteract) {
        const triggerData = sourceData
        onDoInteract(triggerData)
      }
      setTimeout(() => {
        if (getDataDrillDetail) {
          getDataDrillDetail(JSON.stringify({filterObj, brushed, sourceData}))
        }
      }, 500)
    })
  }

  // 设置行的类名
  private setRowClassName = (record, row) =>
   this.state.selectedRow.some((sr) => this.isSameObj(sr, record, true)) ? Styles.selectedRow : Styles.unSelectedRow

  public render () {
    const { data, chartStyles } = this.props
    const { headerFixed, bordered, withPaging, size } = chartStyles.table
    const { tablePagination, tableColumns, tableBodyHeight, mapTableHeaderConfig } = this.state

    // tableWidth是表格的实际总宽度，为当前所有列的width之和
    let tableWidth = 0
    tableColumns.forEach((col) => tableWidth += col.width)
    tableWidth = typeof tableWidth === 'number' ? tableWidth : TOTAL_COLUMN_WIDTH

    // 获取可拖拽列宽的列的配置
    const adjustedTableColumns = this.adjustTableColumns(tableColumns, mapTableHeaderConfig)
    // 获取表格的 scroll配置
    const scroll = this.getTableScroll(adjustedTableColumns, tableWidth, headerFixed, tableBodyHeight)
    // 获取表格的样式配置
    const style = this.getTableStyle(headerFixed, tableBodyHeight)

    // 获取表格的分页配置
    const paginationConfig: PaginationConfig = {
      ...this.basePagination,
      ...tablePagination
    }
    // 不显示总条数的分页
    const paginationWithoutTotal = withPaging && tablePagination.total === -1 ? (
      <PaginationWithoutTotal
        dataLength={data.length}
        size="small"
        {...paginationConfig}
      />
    ) : null
    // 表格的类名
    const tableCls = classnames({
      [Styles.table]: true,
      [Styles.noBorder]: bordered !== undefined && !bordered
    })
    style.width = tableWidth
    return (
      <>
        <AntTable
          style={style}
          className={tableCls}
          ref={this.table}
          size={size}
          dataSource={data}
          rowKey={this.getRowKey}
          components={tableComponents}
          // 列的配置
          columns={adjustedTableColumns}
          pagination={withPaging && tablePagination.total !== -1 ? paginationConfig : false}
          scroll={scroll}
          bordered={bordered}
          rowClassName={this.setRowClassName}
          onRowClick={this.rowClick}
          onChange={this.tableChange}
        />
        {paginationWithoutTotal}
      </>
    )
  }
}

export default Table


function getTableColumns (props: IChartProps) {
  const { chartStyles, widthChangedInInput } = props
  if (!chartStyles.table) {
    return {
      tableColumns: [],
      mapTableHeaderConfig: {}
    }
  }
  const { cols, rows, metrics, data, queryVariables, onSetWidgetProps, onSetNeedUpdateDataParams, pagination, secondaryMetrics, filters, selectedChart, orders, mode, model, onPaginationChange } = props
  const { headerConfig, columnsConfig, autoMergeCell, leftFixedColumns, rightFixedColumns, withNoAggregators } = chartStyles.table
  const tableColumns: Array<ColumnProps<any>> = []
  const mapTableHeaderConfig: IMapTableHeaderConfig = {}
  // tempWidgetProps是用来在onSetWidgetProps中使用的，所以只需要workbench中的原始字段
  const tempWidgetProps = { data, pagination, cols, rows, metrics, secondaryMetrics, filters, chartStyles, selectedChart, orders, mode, model, onPaginationChange }
  // 获取当前总列数
  let totalColumnsLength = 0
  if (Array.isArray(cols) && Array.isArray(metrics)) totalColumnsLength = cols.length + metrics.length
  // 下面新增的列的宽度的逻辑应该是：
  // 1. 新添加进来的列的宽度就是 TOTAL_COLUMN_WIDTH/当前列数
  // 2. 增加列时，用户未手动改动宽度的列的列宽要自动更新为 TOTAL_COLUMN_WIDTH/当前列数
  // 3. 增加列时，用户手动改动宽度的列的列宽就保持为用户改的那个值
  cols.concat(rows).forEach((dimension, index) => {
    const { name, field, format, width, widthChanged, alreadySetWidth, oldColumnCounts } = dimension
    const headerText = getFieldAlias(field, queryVariables || {}) || name
    const column: ColumnProps<any> = {
      key: name,
      title: (field && field.desc) ? (
        <>
          {headerText}
          <Tooltip
            title={field.desc}
            placement="top"
          >
            <Icon className={Styles.headerIcon} type="info-circle" />
          </Tooltip>
        </>
      ) : headerText,
      dataIndex: name,
      width,
      widthChanged,
      alreadySetWidth,
      oldColumnCounts
    }
    if (autoMergeCell) {
      column.render = (text, _, idx) => {
        // dimension cells needs merge
        const rowSpan = getMergedCellSpan(data, name, idx)
        return rowSpan === 1 ? text : { children: text, props: { rowSpan } }
      }
    }
    let headerConfigItem: ITableHeaderConfig = null
    findChildConfig(headerConfig, 'headerName', 'children', name, (config) => {
      headerConfigItem = config
    })

    // columnsConfig默认是空数组，当在 “表格数据设置” 弹框中设置之后就不再为空了
    const columnConfigItem = columnsConfig.find((cfg) => cfg.columnName === name)
    if (isDragged) {
      isDragged = false
    } else {
      // 否则就读取 “表格数据设置” 弹框里的配置
      // 要把 “表格数据设置” 弹框里的设置更新到其中，不然表格里的更改不生效
      if (columnConfigItem && widthChangedInInput) {
        column.sorter = columnConfigItem.sort
        column.width = columnConfigItem.width
        column.widthChanged = columnConfigItem.widthChanged
        column.oldColumnCounts = columnConfigItem.oldColumnCounts
        column.alreadySetWidth = columnConfigItem.alreadySetWidth
      }
    }
    // 如果至少有一列已经调整了列宽，删除一列或多列时，其余列宽不动
    let atLeastOneColumnChanged = false
    if (column.oldColumnCounts <= totalColumnsLength) {
      for (let i = 0; i < cols.length; i++) {
        if (cols[i].widthChanged) {
          // 如果atLeastOneColumnChanged为true，说明是删除了一列或多列并且有至少一列是改动过宽度的情况
          // 但是可能是手动加载数据的，所以可能是删了两列，新增了一列这样，下面不能全局进行判断 column.width和column.widthChanged都为undefined的时候还是要计算数据的
          atLeastOneColumnChanged = true
          break
        }
      }
    }
    // 对列进行初始列宽的设置
    if (column.width && column.widthChanged) {
      // 已经设置过column的width，并且已经通过拖拽或者输入框输入宽度的方式更给了宽度，无论其他列怎么变化，这列都不进行变动
    } else if (column.width && !column.widthChanged) {
      // 已经设置过column的width，但没有通过拖拽或者输入框输入宽度的方式更给宽度
      if (!column.alreadySetWidth || column.oldColumnCounts !== totalColumnsLength) {
        // column.alreadySetWidth可能为undefined, false, true;其中为undefined或false时要进行设置 || 列数变化了（可能增加可能减少）
        if (!atLeastOneColumnChanged) {
          // 排除掉删除了一列或多列并且有至少一列是改动过宽度的情况

          // 需要将column.width更新为TOTAL_COLUMN_WIDTH / totalColumnsLength
          cols[index].width = TOTAL_COLUMN_WIDTH / totalColumnsLength
          // 用alreadySetWidth来控制只设置一次，避免父子组件不断更新的死循环
          cols[index].alreadySetWidth = true
          // 更新 “上一次的列数”为当前column的数量
          cols[index].oldColumnCounts = totalColumnsLength
          // 更改全局数据中该column的width
          tempWidgetProps.cols = cols
          onSetNeedUpdateDataParams(true)
          onSetWidgetProps(tempWidgetProps)
        }
      }
    } else if (!column.width && column.widthChanged) {
      // 不会有这种情况，还未设置过column.width，该column就不可能已经更改过
    } else {
      if (!column.alreadySetWidth) {
        // 第一次渲染该列，未设置过column.width，肯定也没更改过
        // 这里column.totalColumnsLength肯定也为undefined，不用判断
        cols[index].width = TOTAL_COLUMN_WIDTH / totalColumnsLength
        // 初始化column.widthChanged
        cols[index].widthChanged = false
        // 用alreadySetWidth来控制只设置一次，避免父子组件不断更新的死循环
        cols[index].alreadySetWidth = true
        // 更改全局数据中该column的width
        tempWidgetProps.cols = cols
        // 更新 “上一次的列数”为当前column的数量
        cols[index].oldColumnCounts = totalColumnsLength
        onSetNeedUpdateDataParams(true)
        onSetWidgetProps(tempWidgetProps)
      }
    }
    // column.width = getDataColumnWidth(name, columnConfigItem, format, data)
    // column.width = Math.max(+column.width, computeCellWidth(headerConfigItem && headerConfigItem.style, headerText))

    mapTableHeaderConfig[name] = headerConfigItem
    column.onCell = (record) => ({
      config: columnConfigItem,
      format,
      cellVal: record[name],
      cellValRange: null
    })
    tableColumns.push(column)
  })
  metrics.forEach((metric, index) => {
    const { name, field, format, agg, width, widthChanged, alreadySetWidth, oldColumnCounts } = metric
    let expression = decodeMetricName(name)
    if (!withNoAggregators) {
      expression = `${agg}(${expression})`
    }
    const headerText = getFieldAlias(field, queryVariables || {}) || expression
    const column: ColumnProps<any> = {
      key: name,
      title: (field && field.desc) ? (
        <>
          {headerText}
          <Tooltip
            title={field.desc}
            placement="top"
          >
            <Icon className={Styles.headerIcon} type="info-circle" />
          </Tooltip>
        </>
      ) : headerText,
      dataIndex: expression,
      width,
      widthChanged,
      alreadySetWidth,
      oldColumnCounts
    }
    let headerConfigItem: ITableHeaderConfig = null
    findChildConfig(headerConfig, 'headerName', 'children', name, (config) => {
      headerConfigItem = config
    })
    const columnConfigItem = columnsConfig.find((cfg) => cfg.columnName === name)
    if (columnConfigItem) {
      column.sorter = columnConfigItem.sort
      column.width = columnConfigItem.width
      column.widthChanged = columnConfigItem.widthChanged
    }
    // // 对列进行初始列宽的设置
    // column.width = TOTAL_COLUMN_WIDTH / totalColumnsLength
    // 如果至少有一列已经调整了列宽，删除一列或多列时，其余列宽不动
    let atLeastOneColumnChanged = false
    if (column.oldColumnCounts <= totalColumnsLength) {
      for (let i = 0; i < metrics.length; i++) {
        if (metrics[i].widthChanged) {
          // 如果atLeastOneColumnChanged为true，说明是删除了一列或多列并且有至少一列是改动过宽度的情况
          // 但是可能是手动加载数据的，所以可能是删了两列，新增了一列这样，下面不能全局进行判断 column.width和column.widthChanged都为undefined的时候还是要计算数据的
          atLeastOneColumnChanged = true
          break
        }
      }
    }
    // 对列进行初始列宽的设置
    if (column.width && column.widthChanged) {
      // 已经设置过column的width，并且已经通过拖拽或者输入框输入宽度的方式更给了宽度，无论其他列怎么变化，这列都不进行变动
    } else if (column.width && !column.widthChanged) {
      // 已经设置过column的width，但没有通过拖拽或者输入框输入宽度的方式更给宽度
      if (!column.alreadySetWidth || column.oldColumnCounts !== totalColumnsLength) {
        // column.alreadySetWidth可能为undefined, false, true;其中为undefined或false时要进行设置 || 列数变化了（可能增加可能减少）
        if (!atLeastOneColumnChanged) {
          // 排除掉删除了一列或多列并且有至少一列是改动过宽度的情况

          // 需要将column.width更新为TOTAL_COLUMN_WIDTH / totalColumnsLength
          metrics[index].width = TOTAL_COLUMN_WIDTH / totalColumnsLength
          // 用alreadySetWidth来控制只设置一次，避免父子组件不断更新的死循环
          metrics[index].alreadySetWidth = true
          // 更新 “上一次的列数”为当前column的数量
          metrics[index].oldColumnCounts = totalColumnsLength
          // 更改全局数据中该column的width
          tempWidgetProps.metrics = metrics
          onSetNeedUpdateDataParams(true)
          onSetWidgetProps(tempWidgetProps)
        }
      }
    } else if (!column.width && column.widthChanged) {
      // 不会有这种情况，还未设置过column.width，该column就不可能已经更改过
    } else {
      if (!column.alreadySetWidth) {
        // 第一次渲染该列，未设置过column.width，肯定也没更改过
        // 这里column.totalColumnsLength肯定也为undefined，不用判断
        metrics[index].width = TOTAL_COLUMN_WIDTH / totalColumnsLength
        // 初始化column.widthChanged
        metrics[index].widthChanged = false
        // 用alreadySetWidth来控制只设置一次，避免父子组件不断更新的死循环
        metrics[index].alreadySetWidth = true
        // 更改全局数据中该column的width
        tempWidgetProps.metrics = metrics
        // 更新 “上一次的列数”为当前column的数量
        metrics[index].oldColumnCounts = totalColumnsLength
        onSetNeedUpdateDataParams(true)
        onSetWidgetProps(tempWidgetProps)
      }
    }
    // column.width = getDataColumnWidth(expression, columnConfigItem, format, data)
    // column.width = Math.max(+column.width, computeCellWidth(headerConfigItem && headerConfigItem.style, headerText))
    mapTableHeaderConfig[name] = headerConfigItem
    column.onCell = (record) => ({
      config: columnConfigItem,
      format,
      cellVal: record[expression],
      cellValRange: getTableCellValueRange(data, expression, columnConfigItem)
    })
    tableColumns.push(column)
  })

  const groupedColumns: Array<ColumnProps<any>> = []
  traverseConfig<ITableHeaderConfig>(headerConfig, 'children', (currentConfig) => {
    const { key, isGroup, headerName, style } = currentConfig
    if (!isGroup) { return }

    const childrenConfig = currentConfig.children.filter(({ isGroup, key, headerName }) =>
      (!isGroup && tableColumns.findIndex((col) => col.key === headerName) >= 0) ||
      (isGroup && groupedColumns.findIndex((col) => col.key === key) >= 0)
    )
    if (!childrenConfig.length) { return }

    const groupedColumn: ColumnProps<any> = {
      key,
      title: headerName,
      width: 0,
      children: []
    }

    mapTableHeaderConfig[key] = currentConfig

    childrenConfig.sort((cfg1, cfg2) => {
      if (cfg1.isGroup || cfg2.isGroup) { return 0 }
      const cfg1Idx = tableColumns.findIndex((column) => column.key === cfg1.headerName)
      const cfg2Idx = tableColumns.findIndex((column) => column.key === cfg2.headerName)
      return cfg1Idx - cfg2Idx
    })

    let insertIdx = Infinity
    childrenConfig.forEach(({ isGroup, key, headerName }) => {
      const columnIdx = tableColumns.findIndex((column) => column.children ? column.key === key : column.key === headerName)
      insertIdx = Math.min(insertIdx, columnIdx)
      groupedColumn.children.push(tableColumns[columnIdx])
      groupedColumn.width = +groupedColumn.width + (+tableColumns[columnIdx].width)
      tableColumns.splice(columnIdx, 1)
    })
    tableColumns.splice(insertIdx, 0, groupedColumn)
    groupedColumns.push(groupedColumn)
  })

  tableColumns.forEach((column) => {
    const name = (column.children && column.children.length ? column.title : column.dataIndex) as string
    if (leftFixedColumns.includes(name)) {
      column.fixed = 'left'
    }
    if (rightFixedColumns.includes(name)) {
      column.fixed = 'right'
    }
  })
  return { tableColumns, mapTableHeaderConfig }
}

function getPaginationOptions (props: IChartProps) {
  const { chartStyles, pagination } = props
  // fixme
  let pageNo = void 0
  let pageSize = void 0
  let totalCount = void 0
  if (pagination) {
    pageNo = pagination.pageNo
    pageSize =  pagination.pageSize
    totalCount = pagination.totalCount
  }
  // const { pageNo, pageSize, totalCount } = pagination
  const { pageSize: initialPageSize } = chartStyles.table

  const paginationOptions: ITableStates['tablePagination'] = {
    current: pageNo,
    pageSize: pageSize || +initialPageSize,
    total: totalCount,
    simple: true
  }
  return paginationOptions
}
