export type Verdict = "LIKE" | "NEUTRAL" | "DISLIKE";
export type Reorder = "YES" | "MAYBE" | "NO";
export type Context = "DINE_IN" | "TAKEOUT" | "DELIVERY" | "HOME" | "OTHER";
export type PlaceType =
  | "RESTAURANT"
  | "CAFE"
  | "BAKERY"
  | "BAR"
  | "CONVENIENCE"
  | "DELIVERY_ONLY"
  | "OTHER";
export interface User {
  id: string;
  display_name: string;
  created_at: string;
}
interface Owned {
  id: string;
  user_id: string;
  created_at: string;
}
export interface Brand extends Owned {
  name: string;
  normalized_name: string;
}
export interface Place extends Owned {
  name: string;
  normalized_name: string;
  brand_id?: string;
  address?: string;
  place_type: PlaceType;
  external_provider?: string;
  external_place_id?: string;
}
export interface Menu extends Owned {
  name: string;
  normalized_name: string;
  brand_id?: string;
  category?: string;
  description?: string;
  active: boolean;
  favourite_override?: boolean;
}
export interface MenuOffering extends Owned {
  menu_id: string;
  place_id: string;
  price?: number;
  currency: string;
  available: boolean;
}
export interface EatingRecord extends Owned {
  menu_id: string;
  place_id?: string;
  eaten_at: string;
  verdict: Verdict;
  reorder_intent: Reorder;
  short_note: string;
  detailed_note?: string;
  price_paid?: number;
  dining_context?: Context;
  updated_at: string;
}
export interface Photo extends Owned {
  eating_record_id: string;
  storage_path: string;
  width: number;
  height: number;
  sort_order: number;
}
export interface Tag extends Owned {
  name: string;
}
export interface RecordTag {
  user_id: string;
  eating_record_id: string;
  tag_id: string;
}
export interface Archive {
  schema_version: 1;
  user: User;
  brands: Brand[];
  places: Place[];
  menus: Menu[];
  offerings: MenuOffering[];
  records: EatingRecord[];
  photos: Photo[];
  tags: Tag[];
  record_tags: RecordTag[];
  demo: boolean;
}
export interface RecordDraft {
  menu_name: string;
  menu_id?: string;
  force_new_menu?: boolean;
  brand_name: string;
  place_name: string;
  address: string;
  category: string;
  verdict: Verdict;
  reorder_intent: Reorder;
  short_note: string;
  detailed_note: string;
  eaten_at: string;
  price_paid?: number;
  dining_context: Context;
  tags: string[];
  photos: { storage_path: string; width: number; height: number }[];
}
