import { Calculator, FolderOpen, Highlighter, NotebookPen, Paperclip, PencilRuler, PenLine, Scissors } from 'lucide-react'

// Everything the public website says about the business, in one place

export const SHOP = {
  name: 'Royal Stationers',
  phone: '0321-4577629',
  phoneIntl: '923214577629',
  email: 'royalstationer862@gmail.com',
  addressLines: ['Shop #22, First Floor, Bashir Center', '14 Kabeer Street, Urdu Bazar', 'Lahore 54000, Pakistan'],
  addressShort: 'Shop #22, First Floor, Bashir Center, Urdu Bazar, Lahore',
  hours: 'Monday to Saturday, 9:30 am to 8:00 pm',
  hoursNote: 'Friday break 1:00 to 2:30 pm. Sunday closed.',
  rating: '4.8',
  mapUrl: 'https://www.google.com/maps/place/Royal+Stationers/data=!4m2!3m1!1s0x0:0x5250e8685b3ba536',
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Royal+Stationers+Bashir+Center+Urdu+Bazar+Lahore',
  mapEmbedUrl: 'https://www.google.com/maps?q=Royal+Stationers,+Bashir+Center,+14+Kabeer+St,+Urdu+Bazar,+Lahore&output=embed',
}

export const DEFAULT_WA_TEXT = 'Assalam o Alaikum, mujhe Royal Stationers ki rate list chahiye.'

export const waLink = (text = DEFAULT_WA_TEXT) => `https://wa.me/${SHOP.phoneIntl}?text=${encodeURIComponent(text)}`

export const BRANDS = ['next', 'Zuofan', 'Ruya', 'Chanyi', 'Citizen']

// Product photos: Unsplash (free licence), saved in public/images/products
export const CATEGORIES = [
  {
    slug: 'calculators', group: 'office', icon: Calculator, name: 'Calculators',
    text: 'Desktop, scientific and pocket models', image: '/images/products/calculators.webp',
    items: ['Desktop calculators, 12 and 14 digit', 'Scientific calculators', 'Pocket and check calculators', 'Printing calculators'],
    brands: ['Citizen', 'next'], credit: 'Recha Oktaviani',
  },
  {
    slug: 'pens', group: 'office', icon: PenLine, name: 'Pens and ink pens',
    text: 'Ball pens, gel pens and fountain ink pens', image: '/images/products/pens.webp',
    items: ['Ball pens, blue, black and red', 'Gel and roller pens', 'Fountain ink pens and ink', 'Refills'],
    brands: ['Zuofan', 'next'], credit: 'Liviu C.',
  },
  {
    slug: 'markers', group: 'school', icon: Highlighter, name: 'Markers and highlighters',
    text: 'Board markers, permanent and neon', image: '/images/products/markers.webp',
    items: ['White board markers', 'Permanent markers', 'Highlighters, neon and pastel', 'Marker refills and ink'],
    brands: ['next'], credit: 'andrew davies',
  },
  {
    slug: 'files', group: 'office', icon: FolderOpen, name: 'Files and folders',
    text: 'Box files, clear bags and document cases', image: '/images/products/files.webp',
    items: ['Box and lever arch files', 'Clear bags and L folders', 'Document cases', 'Display books'],
    brands: ['next', 'Ruya'], credit: 'Viktor Talashuk',
  },
  {
    slug: 'tape', group: 'office', icon: Scissors, name: 'Tape, glue and scissors',
    text: 'Clear tape, glue sticks and cutters', image: '/images/products/tape.webp',
    items: ['Clear and packing tape', 'Tape dispensers', 'Glue sticks and liquid glue', 'Scissors and cutters'],
    brands: ['Chanyi', 'Ruya'], credit: 'Barry A',
  },
  {
    slug: 'staplers', group: 'office', icon: Paperclip, name: 'Staplers and pins',
    text: 'Staplers, pins, clips and punches', image: '/images/products/staplers.webp',
    items: ['Staplers, mini to heavy duty', 'Stapler pins #10 and 24/6', 'Paper and binder clips', 'Paper punches'],
    brands: ['next'], credit: 'Brett Jordan',
  },
  {
    slug: 'notebooks', group: 'school', icon: NotebookPen, name: 'Notebooks and registers',
    text: 'Exercise books, registers and diaries', image: '/images/products/notebooks.webp',
    items: ['Exercise and copy books', 'Registers and ledgers', 'Spiral notebooks', 'Diaries and note pads'],
    brands: ['next'], credit: 'Marissa Grootes',
  },
  {
    slug: 'school', group: 'school', icon: PencilRuler, name: 'School supplies',
    text: 'Pencil boxes, colours, geometry sets and globes', image: '/images/products/school.webp',
    items: ['Pencils and colour pencils', 'Pencil boxes', 'Geometry sets', 'Globes and school items'],
    brands: ['Ruya', 'next'], credit: 'Jess Bailey',
  },
]

export const GROUPS = [
  { id: 'all', label: 'All departments' },
  { id: 'office', label: 'Office supplies' },
  { id: 'school', label: 'School supplies' },
]
