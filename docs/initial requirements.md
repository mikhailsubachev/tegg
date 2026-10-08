# Intent

Build me a polished, modern note-taking app.

I want the app to be fast, clean, easy to navigate, and designed for someone who regularly works with hundreds of notes on various purposes:

- taking reading notes from books

- Zettelkasten notes

- working notes

- planning trips snd others

I want to be independent on a vendor and vendor specific formats so I want my notes to be stored locally, and synced to general service like dropbox, google drive etc.. 

# Architectural requirements

Every note type should be an object with customizable set of attributes

User can define their own objects

their wil be system objects that user can not change: tasks, quick notes

all notes should be stored locally as .md files in one folder, the folder might have sub-folders 

do it for macOS ARM architecture 

# Sync options

- i do not have a cloud storage, I prefer to use services like dropbox, google drive for syncing

# App capabilities

The app should include:

- mindmap as a specific block for each type of note (optional)

- blocks of each note might be converted to different objects (note types)

- Fast switching between lots of notes

- A useful Recent/Home view

- Universal search

- Notes can embed other notes (objects)

- Quick Capture - sort of inbox workflow to reviewed/unreviewed fast captured notes

- Backlinks between notes

- graph of the linked notes (displayed from/for each note)

- ability to add pictures 

- Easy export to common formats

- ability to embed searches (queries) of different objects within each note

- ability to define queries for each object type or between object types

The interface should feel modern, minimal, spacious, and suitable for desktop and future mobile. 

Beyond these requirements, make your own product, design, architecture, and implementation decisions.
