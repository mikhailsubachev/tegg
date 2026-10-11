//! Files of a new empty vault (FR-VLT-02 AC-1, D-89, D-90). Must equal the owner-approved fixture
//! `tests/fixtures/vaults/new-empty/` (D-99), which FR-VLT-02 AC-3 checks byte for byte.

pub const EMPTY_VAULT: &[(&str, &str)] = &[
    (".tegg/types/daily-note.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Daily Note
plural: Daily Notes
system: true
folder: Daily
icon: calendar
color: purple
review: locked
preview: [date]
attributes:
  - key: date
    name: Date
    type: date
"#),
    (".tegg/types/image.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Image
plural: Images
system: true
folder: Images
icon: image
color: teal
review: false
preview: [width, height]
attributes:
  - key: file
    name: File
    type: file
  - key: media-type
    name: Media type
    type: text
  - key: size
    name: Size
    type: number
  - key: width
    name: Width
    type: number
  - key: height
    name: Height
    type: number
"#),
    (".tegg/types/page.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Page
plural: Pages
system: true
folder: Pages
icon: file-text
color: gray
review: false
preview: []
attributes: []
"#),
    (".tegg/types/pdf.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: PDF
plural: PDFs
system: true
folder: PDFs
icon: file
color: red
review: false
preview: [pages]
attributes:
  - key: file
    name: File
    type: file
  - key: media-type
    name: Media type
    type: text
  - key: size
    name: Size
    type: number
  - key: pages
    name: Pages
    type: number
"#),
    (".tegg/types/quick-note.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Quick Note
plural: Quick Notes
system: true
folder: Quick Notes
icon: zap
color: yellow
review: locked
preview: []
attributes: []
"#),
    (".tegg/types/tag.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Tag
plural: Tags
system: true
folder: Tags
icon: hash
color: green
review: false
preview: [color]
attributes:
  - key: color
    name: Color
    type: color
"#),
    (".tegg/types/task.yml", r#"# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.
version: 1
name: Task
plural: Tasks
system: true
folder: Tasks
icon: check-square
color: blue
review: false
preview: [status, priority, due]
attributes:
  - key: status
    name: Status
    type: select
    options:
      - { label: To do, state: open, color: gray }
      - { label: In progress, state: in-progress, color: blue }
      - { label: Waiting, state: open, color: yellow }
      - { label: Done, state: done, color: green }
      - { label: Cancelled, state: cancelled, color: red }
  - key: priority
    name: Priority
    type: select
    options:
      - { label: High, color: red }
      - { label: Medium, color: orange }
      - { label: Low, color: blue }
      - { label: None, color: gray }
  - key: due
    name: Due date
    type: date
  - key: completed
    name: Completed
    type: date-time
  - key: recurrence
    name: Recurrence
    type: recurrence
"#),
    (".tegg/vault.yml", r#"# Tegg vault settings (FR-STO-06). Machine-local settings live in Application Support (FR-STO-07).
version: 1
default-type: Quick Note
attachments: _attachments
templates: _templates
daily-format: YYYY-MM-DD
"#),
];
