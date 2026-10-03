export type UserRole = 'super_admin' | 'admin' | 'store'

export type TallyType = 'morning' | 'evening'

export type WastageReason = 'spilled' | 'expired' | 'dropped' | 'burnt' | 'other'

export type UOM = 'grams' | 'ml' | 'pieces'

export interface Brand {
  id: string
  name: string
  code: string
  created_at: string
}

export interface Store {
  id: string
  brand_id: string
  name: string
  location: string
  code: string
  is_active: boolean
  created_at: string
  brand?: Brand
}

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  email: string
  store_access: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StaffMember {
  id: string
  store_id: string
  name: string
  is_active: boolean
  created_at: string
}

export interface ItemCategory {
  id: string
  brand_id: string | null
  name: string
  sort_order: number
  created_at: string
}

export interface Item {
  id: string
  category_id: string
  name: string
  uom: UOM
  purchase_unit_name: string | null
  purchase_unit_qty: number | null
  is_daily_tracked: boolean
  is_active: boolean
  created_at: string
  category?: ItemCategory
}

export interface Recipe {
  id: string
  product_name: string
  brand_id: string
  product_category: string
  created_at: string
  ingredients?: RecipeIngredient[]
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  item_id: string
  quantity: number
  notes: string | null
  created_at: string
  item?: Item
}

export interface DailyStockEntry {
  id: string
  store_id: string
  item_id: string
  entry_date: string
  opening_stock: number
  closing_stock: number
  staff_member_id: string | null
  submitted_by_profile_id: string
  created_at: string
  updated_at: string
  item?: Item
  staff_member?: StaffMember
}

export interface DailyWastageLog {
  id: string
  store_id: string
  item_id: string
  entry_date: string
  quantity_wasted: number
  reason: WastageReason
  reason_notes: string | null
  staff_member_id: string | null
  submitted_by_profile_id: string
  created_at: string
  item?: Item
  staff_member?: StaffMember
}

export interface DailyCashTally {
  id: string
  store_id: string
  entry_date: string
  tally_type: TallyType
  denomination_2000: number
  denomination_500: number
  denomination_200: number
  denomination_100: number
  denomination_50: number
  denomination_20: number
  denomination_10: number
  denomination_5: number
  denomination_2: number
  denomination_1: number
  total_amount: number
  staff_member_id: string | null
  submitted_by_profile_id: string
  created_at: string
  staff_member?: StaffMember
}

export interface DailySalesSummary {
  id: string
  store_id: string
  entry_date: string
  gross_sales: number
  net_sales: number
  total_discount: number
  total_tax: number
  total_orders: number
  cash_amount: number
  upi_amount: number
  card_amount: number
  swiggy_amount: number
  zomato_amount: number
  other_online_amount: number
  staff_member_id: string | null
  submitted_by_profile_id: string
  raw_file_url: string | null
  created_at: string
}

export interface DailySalesItem {
  id: string
  sales_summary_id: string
  item_name: string
  quantity_sold: number
  unit_price: number
  total_price: number
  category: string | null
  created_at: string
}

export interface PurchaseOrder {
  id: string
  store_id: string
  item_id: string
  entry_date: string
  quantity: number
  supplier_name: string | null
  po_reference: string | null
  staff_member_id: string | null
  submitted_by_profile_id: string
  created_at: string
  item?: Item
}

export interface VarianceThreshold {
  id: string
  item_id: string | null
  category_id: string | null
  threshold_percent: number
  updated_by_profile_id: string
  created_at: string
  updated_at: string
}

export interface VarianceRecord {
  store_id: string
  item_id: string
  entry_date: string
  theoretical_consumption: number
  actual_consumption: number
  wastage_deduction: number
  tasting_deduction: number
  adjusted_actual: number
  variance: number
  variance_percent: number
  item?: Item
  store?: Store
}

// Form helpers
export interface CashDenominations {
  denomination_2000: number
  denomination_500: number
  denomination_200: number
  denomination_100: number
  denomination_50: number
  denomination_20: number
  denomination_10: number
  denomination_5: number
  denomination_2: number
  denomination_1: number
}

export const DENOMINATIONS = [
  { key: 'denomination_2000' as const, label: '₹2,000', value: 2000 },
  { key: 'denomination_500' as const, label: '₹500', value: 500 },
  { key: 'denomination_200' as const, label: '₹200', value: 200 },
  { key: 'denomination_100' as const, label: '₹100', value: 100 },
  { key: 'denomination_50' as const, label: '₹50', value: 50 },
  { key: 'denomination_20' as const, label: '₹20', value: 20 },
  { key: 'denomination_10' as const, label: '₹10', value: 10 },
  { key: 'denomination_5' as const, label: '₹5', value: 5 },
  { key: 'denomination_2' as const, label: '₹2', value: 2 },
  { key: 'denomination_1' as const, label: '₹1', value: 1 },
] as const

export const WASTAGE_REASONS: { value: WastageReason; label: string }[] = [
  { value: 'spilled', label: 'Spilled' },
  { value: 'expired', label: 'Expired' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'burnt', label: 'Burnt' },
  { value: 'other', label: 'Other' },
]
