import { exportRules, importRules } from '../src/shared/storage.js';
import { mountRulesUI } from '../src/ui/rules-ui.js';

const toast = document.getElementById('toast');
let toastTimer;
function showToast(text, tone = 'success') {
  toast.textContent = text;
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
}

mountRulesUI(document.getElementById('app'), { variant: 'page' });

document.getElementById('export').addEventListener('click', async () => {
  const json = await exportRules();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `autoclick-pilot-rules-${new Date().toISOString().slice(0, 10)}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const fileInput = document.getElementById('import-file');
document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  try {
    const { imported, skipped } = await importRules(await file.text());
    const skippedText = skipped ? `, ${skipped} skipped as invalid` : '';
    showToast(`Imported ${imported} rule${imported === 1 ? '' : 's'}${skippedText}. Sites without access show "Grant access".`);
  } catch (error) {
    showToast(error.message, 'error');
  }
});
