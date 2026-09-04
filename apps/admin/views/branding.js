import * as api from '../api.js';
import { button, field, h, mount, toast } from '../ui.js';

/* Branding and display settings, with a live preview at the chosen shape.
 *
 * Everything here writes to events.branding, which the kiosk reads at runtime,
 * so restyling an event never touches code or needs a deploy. */

const RATIOS = [
  ['9:16', 'Portrait totem — 9:16', 9 / 16],
  ['3:4', 'Portrait — 3:4', 3 / 4],
  ['1:1', 'Square — 1:1', 1],
  ['4:3', 'Landscape — 4:3', 4 / 3],
  ['16:9', 'Landscape — 16:9', 16 / 9],
  ['fill', 'Fill the screen', null],
];

const THEMES = [
  ['midnight', 'Midnight & gold', { bg: 'linear-gradient(160deg,#131d33,#0a1020)', ink: '#f6f1e7', gold: '#d8b26a' }],
  ['ivory', 'Ivory & gold', { bg: 'linear-gradient(160deg,#f5efe4,#e9dfcd)', ink: '#2a2419', gold: '#a9843f' }],
  ['emerald', 'Emerald & gold', { bg: 'linear-gradient(160deg,#0d3a2c,#06231c)', ink: '#f6f1e7', gold: '#e0c07c' }],
  ['blush', 'Blush & rose gold', { bg: 'linear-gradient(160deg,#f7ecec,#efd9d6)', ink: '#3a2020', gold: '#b07a63' }],
  ['noir', 'Noir & platinum', { bg: 'linear-gradient(160deg,#16161a,#08080a)', ink: '#f6f1e7', gold: '#cfd2d6' }],
];

/* Every editable string, grouped as the guest meets them. */
const TEXT_GROUPS = [
  ['Welcome screen', [
    ['welcome_kicker', 'Line above the name', 'e.g. Welcome to the wedding of'],
    ['welcome_title', 'Display name', 'Defaults to the event name'],
    ['welcome_cta', 'Button', 'e.g. Tap here to find your seat'],
    ['welcome_note', 'Line underneath', 'Optional'],
  ]],
  ['Search screen', [
    ['search_title', 'Heading', 'e.g. Find Your Seat'],
    ['subtitle_text', 'Line under the heading', 'e.g. Search by your name'],
    ['search_placeholder', 'Placeholder in the field', ''],
    ['no_match_text', 'When nobody is found', ''],
  ]],
  ['Table reveal', [
    ['reveal_title', 'Heading', "e.g. Here's Your Table"],
    ['reveal_seated_label', 'Line above the table', 'e.g. You are seated at'],
    ['reveal_tagline', 'Closing line', 'Optional'],
    ['search_again_text', 'Button', 'e.g. Search again'],
    ['monogram', 'Monogram in the crest', 'Left blank, initials are used'],
  ]],
];

const DEFAULTS = {
  theme: 'midnight',
  aspect_ratio: '9:16',
  ornament: 'botanical',
  welcome_enabled: true,
  welcome_kicker: 'Welcome to',
  welcome_cta: 'Tap here to find your seat',
  search_title: 'Find Your Seat',
  subtitle_text: 'Search by your name',
  search_placeholder: 'Type your name here',
  no_match_text: 'We could not find that name — please see a host.',
  reveal_title: "Here's Your Table",
  reveal_seated_label: 'You are seated at',
  search_again_text: 'Search again',
};

export function renderBranding(container, event) {
  const branding = Object.assign({}, DEFAULTS, { welcome_title: event.name }, event.branding || {});
  const schema = normaliseSchema(event.extra_field_schema);

  const preview = h('div', { class: 'preview' });
  let previewScreen = 'welcome';

  // --- Controls ----------------------------------------------------------

  function select(key, options) {
    const node = h('select', {
      name: 'branding.' + key,
      onchange: () => { branding[key] = node.value; drawPreview(); },
    }, options.map(([value, label]) => h('option', { value }, label)));
    node.value = branding[key];
    return node;
  }

  function text(key) {
    const input = h('input', {
      type: 'text', name: 'branding.' + key, value: branding[key] || '',
      oninput: () => { branding[key] = input.value; drawPreview(); },
    });
    return input;
  }

  const welcomeToggle = h('input', {
    type: 'checkbox', checked: branding.welcome_enabled !== false,
    onchange: () => { branding.welcome_enabled = welcomeToggle.checked; drawPreview(); },
  });

  const logoInput = h('input', { type: 'file', accept: 'image/*' });
  logoInput.addEventListener('change', () => upload(logoInput, 'logo_url', 'Logo'));

  const heroInput = h('input', { type: 'file', accept: 'image/*' });
  heroInput.addEventListener('change', () => upload(heroInput, 'hero_image_url', 'Photo'));

  async function upload(input, key, what) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      toast(`Uploading ${what.toLowerCase()}…`);
      branding[key] = await api.uploadLogo(event.slug, file);
      drawPreview();
      toast(`${what} uploaded. Remember to save.`, 'ok');
    } catch (error) { toast(error.message, 'error'); }
  }

  function clearImage(key, what) {
    return button(`Remove ${what.toLowerCase()}`, () => {
      delete branding[key];
      drawPreview();
      toast(`${what} removed. Remember to save.`);
    });
  }

  function schemaRows() {
    if (schema.fields.length === 0) {
      return h('p', { class: 'muted' },
        'No extra columns on this event yet. Any column mapped as "Extra data" '
        + 'during a CSV upload appears here, hidden until you tick it.');
    }
    return h('div', {}, schema.fields.map((entry) => {
      const tick = h('input', {
        type: 'checkbox', checked: !!entry.visible,
        onchange: () => { entry.visible = tick.checked; drawPreview(); },
      });
      const label = h('input', {
        type: 'text', value: entry.label || entry.key, class: 'inline-input',
        oninput: () => { entry.label = label.value; drawPreview(); },
      });
      return h('div', { class: 'schema-row' },
        h('label', {}, tick, ' ', h('code', {}, entry.key)), label,
        h('span', { class: 'muted small' }, entry.visible ? 'shown on the kiosk' : 'stored, never shown'));
    }));
  }

  // --- Preview -----------------------------------------------------------

  function drawPreview() {
    const theme = (THEMES.find(([id]) => id === branding.theme) || THEMES[0])[2];
    const ratio = RATIOS.find(([id]) => id === branding.aspect_ratio) || RATIOS[0];
    const shape = ratio[2];

    const screenTabs = h('div', { class: 'preview-tabs' },
      [['welcome', 'Welcome'], ['search', 'Search'], ['reveal', 'Reveal']].map(([id, label]) =>
        h('button', {
          type: 'button',
          class: 'tab' + (previewScreen === id ? ' tab--active' : ''),
          onclick: () => { previewScreen = id; drawPreview(); },
        }, label)));

    const body = previewScreen === 'search' ? searchPreview()
      : previewScreen === 'reveal' ? revealPreview()
      : welcomePreview();

    // The frame carries the real proportion, so the shape choice is visible
    // rather than described.
    const frame = h('div', {
      class: 'preview-frame',
      style: `background:${theme.bg};color:${theme.ink};`
        + (shape ? `aspect-ratio:${shape};` : 'aspect-ratio:9/16;'),
    },
      branding.ornament === 'none' ? null : h('div', { class: 'preview-orn' }),
      h('div', { class: 'preview-body' }, body));

    mount(preview,
      screenTabs,
      frame,
      h('p', { class: 'muted small' },
        shape ? `${ratio[1]}. The kiosk letterboxes to this shape on any screen.`
              : 'Fills whatever screen it is opened on.'));

    function line(cls, value, style) {
      return value ? h('p', { class: cls, style: style || '' }, value) : null;
    }

    function welcomePreview() {
      if (branding.welcome_enabled === false) {
        return [h('p', { class: 'preview-kicker' }, 'Welcome screen is off — guests land straight on search.')];
      }
      return [
        branding.logo_url ? h('img', { src: branding.logo_url, class: 'preview-logo', alt: '' }) : null,
        line('preview-kicker', branding.welcome_kicker),
        line('preview-display', branding.welcome_title || event.name),
        h('div', { class: 'preview-rule', style: `background:${theme.gold}` }),
        branding.hero_image_url ? h('img', { src: branding.hero_image_url, class: 'preview-hero', alt: '' }) : null,
        h('span', { class: 'preview-cta', style: `background:${theme.gold};color:${theme.bg.includes('f5') || theme.bg.includes('f7') ? '#fff' : '#0a1020'}` },
          branding.welcome_cta || 'Tap here'),
        line('preview-kicker', branding.welcome_note),
      ];
    }

    function searchPreview() {
      return [
        line('preview-display preview-display--sm', branding.search_title),
        h('div', { class: 'preview-rule', style: `background:${theme.gold}` }),
        line('preview-kicker', branding.subtitle_text),
        h('div', { class: 'preview-field' }, branding.search_placeholder || ''),
        h('div', { class: 'preview-result' },
          h('span', {}, 'Adaeze Okonkwo'),
          h('span', { style: `color:${theme.gold}` }, 'Table 1')),
        h('div', { class: 'preview-keys' }, Array.from({ length: 10 }, () => h('span', {}))),
      ];
    }

    function revealPreview() {
      const visible = schema.fields.filter((f) => f.visible).map((f) => f.label || f.key);
      return [
        line('preview-script', branding.reveal_title, `color:${theme.gold}`),
        h('div', { class: 'preview-crest', style: `border-color:${theme.gold};color:${theme.gold}` },
          branding.monogram || initials(branding.welcome_title || event.name)),
        line('preview-display preview-display--sm', 'Adaeze Okonkwo'),
        line('preview-kicker', branding.reveal_seated_label),
        h('p', { class: 'preview-table', style: `color:${theme.gold}` }, 'Table 1'),
        visible.length ? h('p', { class: 'preview-kicker' }, visible.join(' · ')) : null,
        line('preview-kicker', branding.reveal_tagline),
      ];
    }
  }

  // --- Save --------------------------------------------------------------

  const save = button('Save', async () => {
    save.disabled = true;
    try {
      await api.updateEvent(event.id, { branding, extra_field_schema: schema });
      event.branding = branding;
      event.extra_field_schema = schema;
      toast('Saved. Kiosks pick it up within two minutes.', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally { save.disabled = false; }
  }, 'primary');

  mount(container,
    h('div', { class: 'split' },
      h('div', {},
        h('div', { class: 'card' },
          h('h3', {}, 'Display'),
          h('p', { class: 'muted small' },
            'How the kiosk is shaped and coloured. The preview beside this shows the real proportion.'),
          field('Screen shape', select('aspect_ratio', RATIOS.map(([id, label]) => [id, label]))),
          field('Theme', select('theme', THEMES.map(([id, label]) => [id, label]))),
          field('Corner ornament', select('ornament', [['botanical', 'Botanical flourish'], ['none', 'None']])),
          field('Logo', h('div', { class: 'stack' }, logoInput, branding.logo_url ? clearImage('logo_url', 'Logo') : null),
            'Shown above the heading'),
          field('Welcome photo', h('div', { class: 'stack' }, heroInput, branding.hero_image_url ? clearImage('hero_image_url', 'Photo') : null),
            'A couple or event photo on the welcome screen')),

        h('div', { class: 'card' },
          h('h3', {}, 'Wording'),
          h('label', { class: 'field field--row' }, welcomeToggle,
            h('span', {}, ' Show a welcome screen before search')),
          TEXT_GROUPS.map(([groupName, rows]) => h('div', {},
            h('h4', { class: 'section' }, groupName),
            rows.map(([key, label, hint]) => field(label, text(key), hint)))),

          h('h4', { class: 'section' }, 'Extra fields from your CSV'),
          h('p', { class: 'muted small' },
            'Tick a field to show it on the reveal screen. Unticked fields stay in the database and are never sent to a kiosk.'),
          schemaRows(),

          h('div', { class: 'form-actions' }, save))),

      h('div', {}, h('h3', {}, 'Preview'), preview)));

  drawPreview();
}

function initials(text) {
  const parts = String(text || '').split(/\s*&\s*|\s+and\s+/i);
  if (parts.length > 1) {
    return parts.map((p) => (p.trim()[0] || '').toUpperCase()).filter(Boolean).join('&');
  }
  return (String(text || '').trim()[0] || '').toUpperCase();
}

function normaliseSchema(raw) {
  const schema = raw && typeof raw === 'object' ? raw : {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return { fields: fields.map((f) => ({ key: f.key, label: f.label || f.key, visible: !!f.visible })) };
}
