import type { TableSpec } from './datasource.js'
import { renderSchema } from './datasource.js'

export const SCHEMA_SPEC: TableSpec[] = [
  {
    table: 'categories',
    comment: '商品品类字典',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'name', type: 'TEXT', comment: '品类名，如 玩具/美妆健康/数码配件' },
    ],
  },
  {
    table: 'customers',
    comment: '客户档案',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'name', type: 'TEXT', comment: '客户姓名' },
      { name: 'email', type: 'TEXT', comment: '邮箱(唯一)' },
      { name: 'city', type: 'TEXT', comment: '所在城市' },
      { name: 'age', type: 'INTEGER', comment: '年龄' },
      { name: 'gender', type: 'TEXT', comment: '性别' },
      { name: 'registered_at', type: 'TEXT', comment: '注册时间' },
      { name: 'is_vip', type: 'INTEGER', comment: '是否会员 0/1' },
    ],
  },
  {
    table: 'products',
    comment: '商品',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'name', type: 'TEXT', comment: '商品名' },
      { name: 'category_id', type: 'INTEGER', comment: '外键→categories.id' },
      { name: 'brand', type: 'TEXT', comment: '品牌' },
      { name: 'price', type: 'REAL', comment: '售价' },
      { name: 'cost', type: 'REAL', comment: '成本' },
      { name: 'stock', type: 'INTEGER', comment: '库存' },
      { name: 'rating', type: 'REAL', comment: '评分 0-5' },
    ],
  },
  {
    table: 'orders',
    comment: '订单主表(订单级金额看 total/discount)',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'customer_id', type: 'INTEGER', comment: '外键→customers.id' },
      { name: 'placed_at', type: 'TEXT', comment: '下单时间 UTC "YYYY-MM-DD HH:MM:SS"' },
      { name: 'status', type: 'TEXT', comment: 'completed/shipped/pending/cancelled/refunded' },
      { name: 'payment', type: 'TEXT', comment: '支付方式' },
      { name: 'total', type: 'REAL', comment: '订单金额(折后)' },
      { name: 'discount', type: 'REAL', comment: '折扣金额' },
    ],
  },
  {
    table: 'order_items',
    comment: '订单明细(按件计价)',
    columns: [
      { name: 'id', type: 'INTEGER', comment: '主键' },
      { name: 'order_id', type: 'INTEGER', comment: '外键→orders.id' },
      { name: 'product_id', type: 'INTEGER', comment: '外键→products.id' },
      { name: 'quantity', type: 'INTEGER', comment: '数量' },
      { name: 'unit_price', type: 'REAL', comment: '成交单价' },
    ],
  },
]

export const FOREIGN_KEYS = [
  'order_items.order_id   → orders.id',
  'order_items.product_id → products.id',
  'products.category_id   → categories.id',
  'orders.customer_id     → customers.id',
]

/** Render the curated schema for the Text2SQL prompt. */
export function describeStructuredSchema(): string {
  return renderSchema(SCHEMA_SPEC, FOREIGN_KEYS)
}