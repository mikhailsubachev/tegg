// An object chip inside a preview (a Tag's objects, D-937): a reference like any link chip (R104), so a click inside the
// popover replaces its content (D-932) and a double-click opens it.
import { chipIcon } from '../links/icons';
import { Icon } from '../shell/Icon';
import { previewHost } from './store';
import { useReference } from './useReference';

export function ObjectChip({ path, title, type }: { path: string; title: string; type: string }) {
  const target = { path: path.normalize('NFC'), fragment: null, kind: 'note' as const };
  const { props } = useReference({ target, kind: 'chip', open: () => previewHost()?.open(target) });
  const i = chipIcon(type);
  return (
    <a href="#" tabIndex={0} className="chip link-chip kind-note" data-link-kind="note" {...props}>
      <Icon name={i.glyph} dataIcon={i.def} size={13} />
      <span data-user-content>{title}</span>
    </a>
  );
}
