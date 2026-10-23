// The tag key (D-185): NFC, lower case; `#` stripped. Equal to `@tegg/doc` `tagKey` and `tegg_format::tag_key`.
export const tagKey = (name: string): string => name.replace(/^#/, '').normalize('NFC').toLowerCase();
