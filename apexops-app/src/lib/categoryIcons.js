// ─── Category → icon + colour, shared by every screen ─────────────────────────
// Matched on keywords so slightly different category names still get an icon.
// Colours for each tone live in the screen's CSS as .xx-tone--<tone>.
import {
  Armchair, Brush, Hammer, HeartPulse, HelpCircle, Megaphone, Monitor, Package,
  Palette, Plug, Shield, Truck, Warehouse, Wifi,
} from 'lucide-react';

const CATEGORY_ICONS = [
  { match:/electric|power|plug/i,           Icon:Plug,       tone:'electric',  short:'Power' },
  { match:/\bav\b|technical|audio|screen/i, Icon:Monitor,    tone:'av',        short:'AV' },
  { match:/wi-?fi|internet|network/i,       Icon:Wifi,       tone:'wifi',      short:'Wi-Fi' },
  { match:/furniture/i,                     Icon:Armchair,   tone:'furniture', short:'Furniture' },
  { match:/graphic|brand|print/i,           Icon:Palette,    tone:'graphics',  short:'Graphics' },
  { match:/stand builder|build|construct/i, Icon:Hammer,     tone:'build',     short:'Stand build' },
  { match:/logistic|freight|loading/i,      Icon:Truck,      tone:'freight',   short:'Freight' },
  { match:/storage/i,                       Icon:Warehouse,  tone:'neutral',   short:'Storage' },
  { match:/clean|waste/i,                   Icon:Brush,      tone:'neutral',   short:'Cleaning' },
  { match:/security/i,                      Icon:Shield,     tone:'security',  short:'Security' },
  { match:/h ?& ?s|medic|health|safety/i,   Icon:HeartPulse, tone:'medic',     short:'H&S / Medic' },
  { match:/organi[sz]er/i,                  Icon:Megaphone,  tone:'organiser', short:'Organiser' },
];

export function categoryVisual(category) {
  const hit = CATEGORY_ICONS.find(item => item.match.test(String(category || '')));
  return hit || { Icon:category ? Package : HelpCircle, tone:'neutral', short:category || 'Other' };
}
