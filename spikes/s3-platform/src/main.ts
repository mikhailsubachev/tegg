import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from './strings';

interface VaultInfo { vault: string; timings: string; files: string[] }

async function refresh() {
  const info = await invoke<VaultInfo>('vault_info');
  document.getElementById('vault')!.textContent = info.vault;
  document.getElementById('timings')!.textContent = info.timings;
  const ul = document.getElementById('files')!;
  ul.replaceChildren(
    ...(info.files.length ? info.files : [t('main.none')]).map((f) => Object.assign(document.createElement('li'), { textContent: f })),
  );
}

await refresh();
await listen('vault:changed', refresh);
