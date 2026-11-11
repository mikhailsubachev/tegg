// Slice Q (v1-queries §4.3, §2.1): the polite live region (`query.editor.results` once per commit) and the alert of a
// refused commit, shared by every block, the query page and the editor.
import { useQueryNotices } from './editorHost';

export function QueryNotices() {
  const { live, alert } = useQueryNotices();
  return (
    <>
      <div className="sr-live sr-only" role="status" aria-live="polite">{live ? <span key={live.n}>{live.text}</span> : null}</div>
      {alert && <div className="query-alert" role="alert" key={alert.n}>{alert.text}</div>}
    </>
  );
}
