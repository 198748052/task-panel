'use strict';

const COLORS = ['blue', 'green', 'amber', 'rose', 'violet', 'cyan', 'slate'];
const COLLAPSE_LIMIT = 5;
const COLOR_HEX = {
  blue: '#2563eb',
  green: '#16a34a',
  amber: '#d97706',
  rose: '#e11d48',
  violet: '#7c3aed',
  cyan: '#0891b2',
  slate: '#475569',
};

const state = {
  tasks: [],
  query: '',
  showArchived: false,
  authEnabled: false,
  maxUploadMb: 100,
  retentionDays: 30,
  r2Enabled: false,
  editingTaskId: null,
  editingColor: 'blue',
  openNodeId: null,
  composer: null,
  expandedTasks: new Set(),
  trash: [],
};

const $ = (sel) => document.querySelector(sel);

const el = {
  loginView: $('#login-view'),
  appView: $('#app-view'),
  loginForm: $('#login-form'),
  loginUsername: $('#login-username'),
  loginPassword: $('#login-password'),
  loginError: $('#login-error'),
  logoutBtn: $('#logout-btn'),
  board: $('#board'),
  emptyState: $('#empty-state'),
  summary: $('#board-summary'),
  search: $('#search-input'),
  showArchived: $('#show-archived'),
  newTaskBtn: $('#new-task-btn'),
  emptyNewBtn: $('#empty-new-btn'),
  taskModal: $('#task-modal'),
  taskForm: $('#task-form'),
  taskModalTitle: $('#task-modal-title'),
  taskTitle: $('#task-title-input'),
  taskDesc: $('#task-desc-input'),
  colorPicker: $('#color-picker'),
  taskCancel: $('#task-cancel'),
  drawer: $('#node-drawer'),
  drawerBackdrop: $('#drawer-backdrop'),
  drawerClose: $('#drawer-close'),
  nodeTitle: $('#node-title'),
  nodeContent: $('#node-content'),
  nodeDelete: $('#node-delete'),
  saveHint: $('#save-hint'),
  fileInput: $('#file-input'),
  dropzone: $('#dropzone'),
  attachList: $('#attach-list'),
  attachMeta: $('#attach-meta'),
  storageR2Opt: $('#storage-r2-opt'),
  storageR2Input: $('#storage-r2-opt input'),
  uploadProgress: $('#upload-progress'),
  uploadProgressBar: $('#upload-progress-bar'),
  uploadProgressText: $('#upload-progress-text'),
  trashBtn: $('#trash-btn'),
  trashModal: $('#trash-modal'),
  trashClose: $('#trash-close'),
  trashList: $('#trash-list'),
  trashEmpty: $('#trash-empty'),
  trashDone: $('#trash-done'),
  trashRetention: $('#trash-retention'),
  updateBtn: $('#update-btn'),
  updateModal: $('#update-modal'),
  updateClose: $('#update-close'),
  updateStep: $('#update-step'),
  updateLog: $('#update-log'),
  updateDone: $('#update-done'),
  previewModal: $('#preview-modal'),
  previewTitle: $('#preview-title'),
  previewDownload: $('#preview-download'),
  previewClose: $('#preview-close'),
  previewBody: $('#preview-body'),
  settingsBtn: $('#settings-btn'),
  settingsModal: $('#settings-modal'),
  settingsClose: $('#settings-close'),
  settingsTest: $('#settings-test'),
  settingsSave: $('#settings-save'),
  settingsMessage: $('#settings-message'),
  r2Status: $('#r2-status'),
  r2AccountId: $('#r2-accountId'),
  r2Bucket: $('#r2-bucket'),
  r2AccessKeyId: $('#r2-accessKeyId'),
  r2SecretAccessKey: $('#r2-secretAccessKey'),
  r2PublicBaseUrl: $('#r2-publicBaseUrl'),
  r2Endpoint: $('#r2-endpoint'),
  r2Region: $('#r2-region'),
  r2Prefix: $('#r2-prefix'),
  r2ForcePathStyle: $('#r2-forcePathStyle'),
  remoteUrl: $('#remote-url'),
  remoteBranch: $('#remote-branch'),
  remoteStatus: $('#remote-status'),
  remoteMessage: $('#remote-message'),
  remoteTest: $('#remote-test'),
  remoteSave: $('#remote-save'),
  accountUsername: $('#account-username'),
  accountCurrent: $('#account-current'),
  accountNew: $('#account-new'),
  accountConfirm: $('#account-confirm'),
  accountSave: $('#account-save'),
  accountStatus: $('#account-status'),
  accountMessage: $('#account-message'),
  toast: $('#toast'),
};

/* ------------------------------- helpers ------------------------------ */

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

const PREVIEW_KINDS = [
  [/^image\//, 'image'],
  [/^application\/pdf$/, 'pdf'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/^text\//, 'text'],
  [/^application\/json$/, 'text'],
];

function previewKind(mime) {
  const hit = PREVIEW_KINDS.find(([re]) => re.test(mime || ''));
  return hit ? hit[1] : null;
}

function fileIcon(mime) {
  return (
    { image: '🖼', pdf: '📕', video: '🎬', audio: '🎵', text: '📄' }[
      previewKind(mime)
    ] || '📄'
  );
}

function inlineUrl(id) {
  return `/api/attachments/${id}?inline=1`;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2200);
}

async function api(method, url, body, isForm = false) {
  const opts = { method, headers: {} };
  if (isForm) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function findTask(taskId) {
  return state.tasks.find((t) => t.id === Number(taskId));
}

function findNode(nodeId) {
  for (const task of state.tasks) {
    const node = task.nodes.find((n) => n.id === Number(nodeId));
    if (node) return { task, node };
  }
  return null;
}

/* -------------------------------- auth -------------------------------- */

function showLogin() {
  el.loginView.classList.remove('hidden');
  el.appView.classList.add('hidden');
}

function showApp() {
  el.loginView.classList.add('hidden');
  el.appView.classList.remove('hidden');
  el.logoutBtn.classList.toggle('hidden', !state.authEnabled);
}

function syncStorageControls() {
  if (!el.storageR2Opt || !el.storageR2Input) return;
  el.storageR2Opt.classList.toggle('disabled', !state.r2Enabled);
  el.storageR2Input.disabled = !state.r2Enabled;
  el.storageR2Opt.title = state.r2Enabled
    ? '上传到 Cloudflare R2'
    : '未配置 Cloudflare R2（缺少 R2_* 环境变量）';
  if (!state.r2Enabled) {
    const r2 = document.querySelector('input[name="storage"][value="r2"]');
    if (r2 && r2.checked) {
      const local = document.querySelector(
        'input[name="storage"][value="local"]',
      );
      if (local) local.checked = true;
    }
  }
}

function selectedStorage() {
  const checked = document.querySelector('input[name="storage"]:checked');
  return checked ? checked.value : 'local';
}

async function boot() {
  try {
    const session = await api('GET', '/api/session');
    state.authEnabled = session.authEnabled;
    state.maxUploadMb = session.maxUploadMb || 100;
    state.retentionDays = session.retentionDays || 30;
    state.r2Enabled = !!session.r2Enabled;
    el.trashRetention.textContent = state.retentionDays;
    syncStorageControls();
    if (!session.authed) {
      showLogin();
      return;
    }
    showApp();
    await refresh();
  } catch (err) {
    showLogin();
  }
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.loginError.classList.add('hidden');
  try {
    await api('POST', '/api/login', {
      username: el.loginUsername.value.trim(),
      password: el.loginPassword.value,
    });
    el.loginPassword.value = '';
    showApp();
    await refresh();
  } catch (err) {
    el.loginError.textContent = err.message || '登录失败';
    el.loginError.classList.remove('hidden');
  }
});

el.logoutBtn.addEventListener('click', async () => {
  await api('POST', '/api/logout');
  state.tasks = [];
  showLogin();
});

/* ------------------------------- board -------------------------------- */

async function refresh() {
  const data = await api('GET', '/api/tasks');
  state.tasks = data.tasks;
  renderBoard();
}

function visibleTasks() {
  const q = state.query.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (!state.showArchived && task.archived) return false;
    if (!q) return true;
    if (task.title.toLowerCase().includes(q)) return true;
    if ((task.description || '').toLowerCase().includes(q)) return true;
    return task.nodes.some((n) => n.title.toLowerCase().includes(q));
  });
}

function renderBoard() {
  const tasks = visibleTasks();
  const active = state.tasks.filter((t) => !t.archived);
  const totalNodes = active.reduce((sum, t) => sum + t.nodes.length, 0);
  const totalBytes = state.tasks.reduce(
    (sum, t) =>
      sum +
      t.nodes.reduce(
        (s, n) =>
          s + n.attachments.reduce((a, x) => a + (Number(x.size) || 0), 0),
        0,
      ),
    0,
  );
  const parts = [];
  if (active.length) {
    parts.push(`${active.length} 个进行中任务`, `共 ${totalNodes} 个节点`);
  }
  if (totalBytes) parts.push(`附件 ${formatSize(totalBytes)}`);
  el.summary.textContent = parts.join(' · ');

  el.board.innerHTML = tasks.map(cardHtml).join('');
  const hasAny = state.tasks.length > 0;
  const showEmpty = tasks.length === 0;
  el.emptyState.classList.toggle('hidden', !showEmpty);
  el.emptyState.querySelector('p').textContent = hasAny
    ? '没有匹配的任务'
    : '还没有任务';
  el.emptyNewBtn.classList.toggle('hidden', hasAny);
}

function cardHtml(task) {
  const total = task.nodes.length;
  const collapsed = total > COLLAPSE_LIMIT && !state.expandedTasks.has(task.id);
  const nodesHtml = total
    ? task.nodes
        .map((n, i) => (collapsed && i >= COLLAPSE_LIMIT ? '' : nodeRowHtml(n, i)))
        .join('')
    : '<li class="card-empty">暂无节点，点击下方按钮添加</li>';
  const toggleHtml =
    total > COLLAPSE_LIMIT
      ? `<button type="button" class="node-toggle">${
          collapsed
            ? `展开全部（还有 ${total - COLLAPSE_LIMIT} 个）`
            : '收起'
        }</button>`
      : '';
  const composerOpen = state.composer && state.composer.taskId === task.id;
  const footHtml = composerOpen
    ? composerHtml()
    : `<div class="card-foot">
         <button type="button" class="add-node-trigger">+ 添加节点</button>
       </div>`;
  return `
    <article class="card${task.archived ? ' archived' : ''}" data-id="${task.id}" data-color="${escapeHtml(
      task.color || 'blue',
    )}" draggable="true">
      <div class="card-head">
        <span class="card-drag-handle" title="拖拽排序">⣿</span>
        <div class="card-title-wrap">
          <h3 class="card-title">${escapeHtml(task.title)}</h3>
          ${
            task.description
              ? `<p class="card-desc">${escapeHtml(task.description)}</p>`
              : ''
          }
        </div>
        <div class="card-menu">
          <button class="icon-btn card-edit" title="编辑任务">✎</button>
          <button class="icon-btn card-archive" title="${
            task.archived ? '取消归档' : '归档'
          }">${task.archived ? '↩' : '⌄'}</button>
          <button class="icon-btn card-delete" title="删除任务">🗑</button>
        </div>
      </div>
      <div class="card-progress">
        <span>${total} 个节点</span>
        <span>更新于 ${formatDate(task.updated_at)}</span>
      </div>
      <ul class="node-list">${nodesHtml}</ul>
      ${toggleHtml}
      ${footHtml}
    </article>
  `;
}

function nodeRowHtml(node, index) {
  const count = node.attachments.length;
  const size = node.attachments.reduce((s, a) => s + (Number(a.size) || 0), 0);
  return `
    <li class="node-row" data-id="${node.id}" draggable="true">
      <span class="node-index">${index + 1}</span>
      <button type="button" class="node-name" title="点击查看/编辑内容">${escapeHtml(
        node.title,
      )}</button>
      ${
        count
          ? `<span class="node-badge" title="${count} 个附件 · ${formatSize(
              size,
            )}">📎 ${count}</span>`
          : ''
      }
      <button type="button" class="node-del" title="删除节点">✕</button>
    </li>
  `;
}

function composerHtml() {
  const c = state.composer;
  return `
    <div class="node-composer">
      <input
        type="text"
        class="composer-title"
        placeholder="节点名称"
        maxlength="160"
        value="${escapeHtml(c.title)}"
      />
      <textarea
        class="composer-content"
        placeholder="完成内容（可稍后补充）"
      >${escapeHtml(c.content)}</textarea>
      <div class="composer-toolbar">
        <label class="btn btn-small btn-ghost composer-upload">
          添加附件
          <input type="file" class="composer-file-input" multiple hidden />
        </label>
        <select class="composer-storage" title="存储位置">
          <option value="local">本地</option>
          <option value="r2"${state.r2Enabled ? '' : ' disabled'}>R2</option>
        </select>
        <span class="attach-size">${c.files.length ? `${c.files.length} 个文件` : ''}</span>
      </div>
      <div class="upload-progress composer-progress hidden">
        <div class="upload-progress-track">
          <div class="upload-progress-bar"></div>
        </div>
        <span class="upload-progress-text"></span>
      </div>
      <ul class="composer-files">${composerFilesHtml()}</ul>
      <div class="composer-actions">
        <button type="button" class="btn btn-ghost btn-small composer-cancel">取消</button>
        <button type="button" class="btn btn-primary btn-small composer-save">保存节点</button>
      </div>
    </div>
  `;
}

function composerFilesHtml() {
  if (!state.composer || !state.composer.files.length) return '';
  return state.composer.files
    .map(
      (f, i) => `
      <li class="composer-file">
        <span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="attach-size">${formatSize(f.size)}</span>
        <button type="button" class="icon-btn composer-file-del" data-index="${i}" title="移除">✕</button>
      </li>`,
    )
    .join('');
}

function openComposer(taskId) {
  state.composer = { taskId, title: '', content: '', files: [] };
  renderBoard();
  const input = document.querySelector(
    `.card[data-id="${taskId}"] .composer-title`,
  );
  if (input) input.focus();
}

function closeComposer() {
  state.composer = null;
  renderBoard();
}

function renderComposerFiles() {
  const list = document.querySelector('.node-composer .composer-files');
  if (list) list.innerHTML = composerFilesHtml();
  const toolbarCount = document.querySelector('.node-composer .composer-toolbar .attach-size');
  if (toolbarCount) {
    toolbarCount.textContent = state.composer?.files.length
      ? `${state.composer.files.length} 个文件`
      : '';
  }
}

async function saveComposer(taskId) {
  const c = state.composer;
  if (!c || c.taskId !== taskId) return;
  const title = c.title.trim();
  if (!title) {
    toast('请填写节点名称');
    const input = document.querySelector(
      `.card[data-id="${taskId}"] .composer-title`,
    );
    if (input) input.focus();
    return;
  }
  try {
    const res = await api('POST', `/api/tasks/${taskId}/nodes`, {
      title,
      content: c.content,
    });
    if (c.files.length) {
      const target =
        document.querySelector('.node-composer .composer-storage')?.value ===
        'r2'
          ? 'r2'
          : 'local';
      setComposerProgress(true, 0, '上传中 0%');
      try {
        await uploadWithProgress(
          `/api/nodes/${res.node.id}/attachments?storage=${target}`,
          c.files,
          (ratio) =>
            setComposerProgress(true, ratio, `上传中 ${Math.round(ratio * 100)}%`),
        );
      } catch (err) {
        toast(`节点已创建，但附件上传失败：${err.message}`);
      } finally {
        setComposerProgress(false, 0, '');
      }
    }
    state.composer = null;
    await refresh();
    toast('节点已创建');
  } catch (err) {
    toast(err.message);
  }
}

/* ------------------------------ task CRUD ----------------------------- */

function openTaskModal(task) {
  state.editingTaskId = task ? task.id : null;
  state.editingColor = task ? task.color || 'blue' : 'blue';
  el.taskModalTitle.textContent = task ? '编辑任务' : '新建任务';
  el.taskTitle.value = task ? task.title : '';
  el.taskDesc.value = task ? task.description || '' : '';
  renderColorPicker();
  el.taskModal.classList.remove('hidden');
  setTimeout(() => el.taskTitle.focus(), 30);
}

function closeTaskModal() {
  el.taskModal.classList.add('hidden');
  state.editingTaskId = null;
}

function renderColorPicker() {
  el.colorPicker.innerHTML = COLORS.map(
    (c) =>
      `<span class="color-dot${
        c === state.editingColor ? ' selected' : ''
      }" data-color="${c}" style="background:${COLOR_HEX[c]}"></span>`,
  ).join('');
}

el.colorPicker.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  state.editingColor = dot.dataset.color;
  renderColorPicker();
});

el.taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: el.taskTitle.value.trim(),
    description: el.taskDesc.value,
    color: state.editingColor,
  };
  if (!payload.title) return;
  try {
    if (state.editingTaskId) {
      await api('PATCH', `/api/tasks/${state.editingTaskId}`, payload);
    } else {
      await api('POST', '/api/tasks', payload);
    }
    closeTaskModal();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

el.taskCancel.addEventListener('click', closeTaskModal);
el.taskModal.addEventListener('click', (e) => {
  if (e.target === el.taskModal) closeTaskModal();
});

el.newTaskBtn.addEventListener('click', () => openTaskModal(null));
el.emptyNewBtn.addEventListener('click', () => openTaskModal(null));

el.search.addEventListener('input', () => {
  state.query = el.search.value;
  renderBoard();
});

el.showArchived.addEventListener('change', () => {
  state.showArchived = el.showArchived.checked;
  renderBoard();
});

/* --------------------------- board interactions ----------------------- */

el.board.addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const taskId = Number(card.dataset.id);
  const task = findTask(taskId);

  if (e.target.closest('.card-edit')) {
    openTaskModal(task);
    return;
  }
  if (e.target.closest('.card-archive')) {
    await api('PATCH', `/api/tasks/${taskId}`, { archived: !task.archived });
    await refresh();
    return;
  }
  if (e.target.closest('.card-delete')) {
    if (
      !confirm(
        `确定将任务「${task.title}」移入回收站吗？其节点与附件会一并移入，可在回收站恢复。`,
      )
    ) {
      return;
    }
    await api('DELETE', `/api/tasks/${taskId}`);
    if (state.composer?.taskId === taskId) state.composer = null;
    await refresh();
    toast('任务已移入回收站');
    return;
  }

  if (e.target.closest('.add-node-trigger')) {
    openComposer(taskId);
    return;
  }
  if (e.target.closest('.composer-cancel')) {
    closeComposer();
    return;
  }
  if (e.target.closest('.composer-save')) {
    await saveComposer(taskId);
    return;
  }
  if (e.target.closest('.composer-file-del')) {
    const index = Number(e.target.closest('.composer-file-del').dataset.index);
    state.composer.files.splice(index, 1);
    renderComposerFiles();
    return;
  }
  if (e.target.closest('.node-toggle')) {
    if (state.expandedTasks.has(taskId)) state.expandedTasks.delete(taskId);
    else state.expandedTasks.add(taskId);
    renderBoard();
    return;
  }

  const nodeRow = e.target.closest('.node-row');
  if (nodeRow) {
    const nodeId = Number(nodeRow.dataset.id);
    if (e.target.closest('.node-del')) {
      if (!confirm('确定将该节点及其附件移入回收站吗？')) return;
      await api('DELETE', `/api/nodes/${nodeId}`);
      await refresh();
      toast('节点已移入回收站');
      return;
    }
    if (e.target.closest('.node-name')) {
      openDrawer(nodeId);
    }
  }
});

el.board.addEventListener('input', (e) => {
  if (!state.composer) return;
  if (e.target.classList.contains('composer-title')) {
    state.composer.title = e.target.value;
  } else if (e.target.classList.contains('composer-content')) {
    state.composer.content = e.target.value;
  }
});

el.board.addEventListener('change', (e) => {
  const fileInput = e.target.closest('.composer-file-input');
  if (!fileInput || !state.composer) return;
  for (const file of fileInput.files) state.composer.files.push(file);
  fileInput.value = '';
  renderComposerFiles();
});

/* ------------------------------- drawer ------------------------------- */

function openDrawer(nodeId) {
  const found = findNode(nodeId);
  if (!found) return;
  state.openNodeId = nodeId;
  el.nodeTitle.value = found.node.title;
  el.nodeContent.value = found.node.content || '';
  el.saveHint.textContent = '';
  renderAttachments(found.node.attachments);
  el.drawerBackdrop.classList.remove('hidden');
  el.drawer.classList.remove('hidden');
  el.drawer.setAttribute('aria-hidden', 'false');
  setTimeout(() => el.nodeContent.focus(), 60);
}

function closeDrawer() {
  state.openNodeId = null;
  el.drawerBackdrop.classList.add('hidden');
  el.drawer.classList.add('hidden');
  el.drawer.setAttribute('aria-hidden', 'true');
}

el.drawerClose.addEventListener('click', closeDrawer);
el.drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.previewModal.classList.contains('hidden')) closePreview();
  else if (!el.settingsModal.classList.contains('hidden')) closeSettings();
  else if (!el.updateModal.classList.contains('hidden')) closeUpdate();
  else if (!el.trashModal.classList.contains('hidden')) closeTrash();
  else if (!el.taskModal.classList.contains('hidden')) closeTaskModal();
  else if (!el.drawer.classList.contains('hidden')) closeDrawer();
  else if (state.composer) closeComposer();
});

let saveTimer = null;
function scheduleSave() {
  el.saveHint.textContent = '编辑中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNode, 600);
}

async function saveNode() {
  if (!state.openNodeId) return;
  const payload = {
    title: el.nodeTitle.value.trim() || '未命名节点',
    content: el.nodeContent.value,
  };
  try {
    const res = await api('PATCH', `/api/nodes/${state.openNodeId}`, payload);
    const found = findNode(state.openNodeId);
    if (found) {
      found.node.title = res.node.title;
      found.node.content = res.node.content;
    }
    el.saveHint.textContent = `已保存 ${formatDate(new Date().toISOString())}`;
    renderBoard();
  } catch (err) {
    el.saveHint.textContent = '保存失败';
    toast(err.message);
  }
}

el.nodeContent.addEventListener('input', scheduleSave);
el.nodeTitle.addEventListener('input', scheduleSave);
el.nodeTitle.addEventListener('blur', () => {
  if (state.openNodeId) saveNode();
});

el.nodeDelete.addEventListener('click', async () => {
  if (!state.openNodeId) return;
  if (!confirm('确定将该节点及其附件移入回收站吗？')) return;
  await api('DELETE', `/api/nodes/${state.openNodeId}`);
  closeDrawer();
  await refresh();
  toast('节点已移入回收站');
});

/* ----------------------------- attachments ---------------------------- */

function renderAttachments(list) {
  const total = list.reduce((s, a) => s + (Number(a.size) || 0), 0);
  el.attachMeta.textContent = list.length
    ? `${list.length} 个附件 · 共 ${formatSize(total)} · 单文件上限 ${state.maxUploadMb} MB`
    : `单文件上限 ${state.maxUploadMb} MB`;
  if (!list.length) {
    el.attachList.innerHTML =
      '<li class="card-empty" style="padding:6px 2px">暂无附件</li>';
    return;
  }
  el.attachList.innerHTML = list
    .map((a) => {
      const kind = previewKind(a.mime_type);
      const isR2 = a.storage === 'r2' && a.url;
      const base = isR2 ? a.url : `/api/attachments/${a.id}`;
      const inlineHref = isR2 ? a.url : `${base}?inline=1`;
      const thumb =
        kind === 'image'
          ? `<img class="attach-thumb" src="${inlineHref}" alt="" loading="lazy" />`
          : `<span class="attach-thumb">${fileIcon(a.mime_type)}</span>`;
      const nameCell = kind
        ? `<button type="button" class="attach-name attach-preview" data-id="${
            a.id
          }" title="点击预览">${escapeHtml(a.original_name)}</button>`
        : `<a class="attach-name" href="${base}" download title="${escapeHtml(
            a.original_name,
          )}">${escapeHtml(a.original_name)}</a>`;
      const badge = `<span class="attach-badge" title="存储位置">${
        isR2 ? 'R2' : '本地'
      }</span>`;
      return `
        <li class="attach-item" data-id="${a.id}">
          ${thumb}
          <div class="attach-info">
            ${nameCell}
            <span class="attach-size">${formatSize(a.size)} · ${formatDate(
              a.created_at,
            )} ${badge}</span>
          </div>
          <button type="button" class="icon-btn attach-rename" title="重命名">✎</button>
          <a class="btn btn-small btn-ghost" href="${base}" download>下载</a>
          <button type="button" class="icon-btn attach-del" title="移入回收站">✕</button>
        </li>
      `;
    })
    .join('');
}

function currentNode() {
  return state.openNodeId ? findNode(state.openNodeId)?.node || null : null;
}

el.attachList.addEventListener('click', async (e) => {
  const item = e.target.closest('.attach-item');
  if (!item) return;
  const id = Number(item.dataset.id);

  if (e.target.closest('.attach-preview')) {
    const att = currentNode()?.attachments.find((a) => a.id === id);
    if (att) openPreview(att);
    return;
  }

  if (e.target.closest('.attach-rename')) {
    await renameAttachment(id);
    return;
  }

  if (e.target.closest('.attach-del')) {
    if (!confirm('确定将该附件移入回收站吗？')) return;
    await api('DELETE', `/api/attachments/${id}`);
    const node = currentNode();
    if (node) {
      node.attachments = node.attachments.filter((a) => a.id !== id);
      renderAttachments(node.attachments);
      renderBoard();
    }
    toast('附件已移入回收站');
  }
});

async function renameAttachment(id) {
  const node = currentNode();
  const att = node?.attachments.find((a) => a.id === id);
  if (!att) return;
  const next = prompt('附件名称', att.original_name);
  if (next === null) return;
  const name = next.trim();
  if (!name || name === att.original_name) return;
  try {
    const res = await api('PATCH', `/api/attachments/${id}`, {
      original_name: name,
    });
    att.original_name = res.attachment.original_name;
    renderAttachments(node.attachments);
    toast('已重命名');
  } catch (err) {
    toast(err.message);
  }
}

function setUploadProgress(show, ratio, text) {
  el.uploadProgress.classList.toggle('hidden', !show);
  el.uploadProgressBar.style.width = `${Math.round((ratio || 0) * 100)}%`;
  el.uploadProgressText.textContent = text || '';
}

function setComposerProgress(show, ratio, text) {
  const box = document.querySelector('.node-composer .composer-progress');
  if (!box) return;
  box.classList.toggle('hidden', !show);
  const bar = box.querySelector('.upload-progress-bar');
  const label = box.querySelector('.upload-progress-text');
  if (bar) bar.style.width = `${Math.round((ratio || 0) * 100)}%`;
  if (label) label.textContent = text || '';
}

function uploadWithProgress(url, files, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) {
        showLogin();
        reject(new Error('unauthorized'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
        } catch {
          resolve(null);
        }
        return;
      }
      let message = `上传失败 (${xhr.status})`;
      try {
        const data = JSON.parse(xhr.responseText);
        message = data.message || data.error || message;
      } catch {
        /* ignore */
      }
      reject(new Error(message));
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
    xhr.send(form);
  });
}

async function uploadFiles(files) {
  if (!state.openNodeId || !files.length) return;
  setUploadProgress(true, 0, '上传中 0%');
  try {
    const res = await uploadWithProgress(
      `/api/nodes/${state.openNodeId}/attachments?storage=${selectedStorage()}`,
      files,
      (ratio) => setUploadProgress(true, ratio, `上传中 ${Math.round(ratio * 100)}%`),
    );
    const node = currentNode();
    if (node) {
      node.attachments.push(...(res?.attachments || []));
      renderAttachments(node.attachments);
      renderBoard();
    }
    toast(`已上传 ${res?.attachments?.length || 0} 个文件`);
  } catch (err) {
    toast(err.message);
  } finally {
    setUploadProgress(false, 0, '');
  }
}

el.fileInput.addEventListener('change', () => {
  uploadFiles([...el.fileInput.files]);
  el.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  el.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('dragover');
  }),
);
['dragleave', 'drop'].forEach((evt) =>
  el.dropzone.addEventListener(evt, () => el.dropzone.classList.remove('dragover')),
);
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadFiles([...e.dataTransfer.files]);
});
el.dropzone.addEventListener('click', () => el.fileInput.click());

/* ------------------------------ preview ------------------------------- */

function openPreview(att) {
  const kind = previewKind(att.mime_type);
  if (!kind) return;
  const isR2 = att.storage === 'r2' && att.url;
  el.previewTitle.textContent = att.original_name;
  el.previewDownload.href = isR2 ? att.url : `/api/attachments/${att.id}`;
  el.previewDownload.setAttribute('download', att.original_name);
  const url = isR2 ? att.url : inlineUrl(att.id);
  if (kind === 'image') {
    el.previewBody.innerHTML = `<img class="preview-media" src="${url}" alt="" />`;
  } else if (kind === 'pdf') {
    el.previewBody.innerHTML = `<iframe class="preview-frame" src="${url}" title="PDF 预览"></iframe>`;
  } else if (kind === 'video') {
    el.previewBody.innerHTML = `<video class="preview-media" src="${url}" controls></video>`;
  } else if (kind === 'audio') {
    el.previewBody.innerHTML = `<audio class="preview-audio" src="${url}" controls></audio>`;
  } else {
    el.previewBody.innerHTML = '<pre class="preview-text">加载中…</pre>';
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('加载失败'))))
      .then((text) => {
        el.previewBody.innerHTML = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
      })
      .catch((err) => {
        el.previewBody.innerHTML = `<pre class="preview-text">${escapeHtml(
          err.message,
        )}</pre>`;
      });
  }
  el.previewModal.classList.remove('hidden');
}

function closePreview() {
  el.previewModal.classList.add('hidden');
  el.previewBody.innerHTML = '';
}

el.previewClose.addEventListener('click', closePreview);
el.previewModal.addEventListener('click', (e) => {
  if (e.target === el.previewModal) closePreview();
});

/* ------------------------------- trash -------------------------------- */

const TRASH_ICON = { task: '🗂', node: '📝', attachment: '📎' };
const TRASH_LABEL = { task: '任务', node: '节点', attachment: '附件' };

function trashItemHtml(item) {
  const meta = [`${TRASH_LABEL[item.type] || '项目'} · 删除于 ${formatDate(item.deleted_at)}`];
  if (item.nodes || item.attachments) {
    meta.push(`${item.nodes} 个节点 · ${item.attachments} 个附件`);
  }
  return `
    <li class="trash-item" data-batch="${escapeHtml(item.batch)}">
      <span class="trash-icon">${TRASH_ICON[item.type] || '📄'}</span>
      <div class="trash-info">
        <span class="trash-title">${escapeHtml(item.title)}</span>
        ${item.parent ? `<span class="trash-parent">${escapeHtml(item.parent)}</span>` : ''}
        <span class="trash-meta">${escapeHtml(meta.join(' · '))}</span>
      </div>
      <span class="trash-days">剩余 ${item.days_left} 天</span>
      <button type="button" class="btn btn-small btn-ghost trash-restore">恢复</button>
      <button type="button" class="btn btn-small btn-danger-ghost trash-purge">彻底删除</button>
    </li>`;
}

function renderTrash() {
  if (!state.trash.length) {
    el.trashList.innerHTML = '<li class="card-empty">回收站是空的</li>';
    el.trashEmpty.classList.add('hidden');
    return;
  }
  el.trashEmpty.classList.remove('hidden');
  el.trashList.innerHTML = state.trash.map(trashItemHtml).join('');
}

async function reloadTrash() {
  const data = await api('GET', '/api/trash');
  state.trash = data.items || [];
  state.retentionDays = data.retentionDays || state.retentionDays;
  el.trashRetention.textContent = state.retentionDays;
  renderTrash();
}

async function openTrash() {
  try {
    await reloadTrash();
    el.trashModal.classList.remove('hidden');
  } catch (err) {
    toast(err.message);
  }
}

function closeTrash() {
  el.trashModal.classList.add('hidden');
}

el.trashBtn.addEventListener('click', openTrash);
el.trashClose.addEventListener('click', closeTrash);
el.trashDone.addEventListener('click', closeTrash);
el.trashModal.addEventListener('click', (e) => {
  if (e.target === el.trashModal) closeTrash();
});

el.trashList.addEventListener('click', async (e) => {
  const item = e.target.closest('.trash-item');
  if (!item) return;
  const batch = item.dataset.batch;
  if (e.target.closest('.trash-restore')) {
    try {
      await api('POST', `/api/trash/${batch}/restore`);
      await reloadTrash();
      await refresh();
      toast('已恢复');
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  if (e.target.closest('.trash-purge')) {
    if (!confirm('彻底删除后将无法恢复，确定继续吗？')) return;
    try {
      await api('DELETE', `/api/trash/${batch}`);
      await reloadTrash();
      toast('已彻底删除');
    } catch (err) {
      toast(err.message);
    }
  }
});

el.trashEmpty.addEventListener('click', async () => {
  if (!confirm('清空回收站会彻底删除全部内容且无法恢复，确定继续吗？')) return;
  try {
    await api('POST', '/api/trash/empty');
    await reloadTrash();
    toast('回收站已清空');
  } catch (err) {
    toast(err.message);
  }
});

/* ------------------------------ settings ------------------------------ */

function showSettingsMessage(kind, text) {
  el.settingsMessage.textContent = text;
  el.settingsMessage.className = `settings-message ${kind}`;
  el.settingsMessage.classList.remove('hidden');
}

function fillSettingsForm(values, enabled, hasSecret) {
  el.r2AccountId.value = values.accountId || '';
  el.r2Bucket.value = values.bucket || '';
  el.r2AccessKeyId.value = values.accessKeyId || '';
  el.r2SecretAccessKey.value = '';
  el.r2SecretAccessKey.placeholder = hasSecret
    ? '已配置，留空则不修改'
    : '请输入 Secret Access Key';
  el.r2PublicBaseUrl.value = values.publicBaseUrl || '';
  const derived = values.accountId
    ? `https://${values.accountId}.r2.cloudflarestorage.com`
    : '';
  el.r2Endpoint.value =
    values.endpoint && values.endpoint !== derived ? values.endpoint : '';
  el.r2Region.value = values.region && values.region !== 'auto' ? values.region : '';
  el.r2Prefix.value = values.prefix || '';
  el.r2ForcePathStyle.checked = !!values.forcePathStyle;
  el.r2Status.textContent = enabled ? '已启用' : '未配置';
  el.r2Status.classList.toggle('on', enabled);
}

function readSettingsForm() {
  return {
    accountId: el.r2AccountId.value.trim(),
    bucket: el.r2Bucket.value.trim(),
    accessKeyId: el.r2AccessKeyId.value.trim(),
    secretAccessKey: el.r2SecretAccessKey.value.trim(),
    publicBaseUrl: el.r2PublicBaseUrl.value.trim(),
    endpoint: el.r2Endpoint.value.trim(),
    region: el.r2Region.value.trim(),
    prefix: el.r2Prefix.value.trim(),
    forcePathStyle: el.r2ForcePathStyle.checked,
  };
}

async function openSettings() {
  try {
    const [data, system, account] = await Promise.all([
      api('GET', '/api/settings'),
      api('GET', '/api/system'),
      api('GET', '/api/account'),
    ]);
    fillSettingsForm(data.r2.values, data.r2.enabled, data.r2.hasSecret);
    fillRemoteForm(system);
    fillAccountForm(account);
    el.settingsMessage.classList.add('hidden');
    el.remoteMessage.classList.add('hidden');
    el.accountMessage.classList.add('hidden');
    el.settingsModal.classList.remove('hidden');
  } catch (err) {
    toast(err.message);
  }
}

function fillAccountForm(account) {
  const username = (account && account.username) || '';
  el.accountUsername.value = username;
  el.accountCurrent.value = '';
  el.accountNew.value = '';
  el.accountConfirm.value = '';
  el.accountStatus.textContent = username ? '已启用' : '-';
  el.accountStatus.classList.toggle('on', !!username);
}

function showAccountMessage(kind, text) {
  el.accountMessage.textContent = text;
  el.accountMessage.className = `settings-message ${kind}`;
  el.accountMessage.classList.remove('hidden');
}

async function saveAccount() {
  const newPassword = el.accountNew.value;
  if (newPassword && newPassword !== el.accountConfirm.value) {
    showAccountMessage('err', '两次输入的新密码不一致');
    return;
  }
  el.accountSave.disabled = true;
  try {
    const res = await api('PUT', '/api/account', {
      username: el.accountUsername.value.trim(),
      currentPassword: el.accountCurrent.value,
      newPassword,
    });
    fillAccountForm(res);
    showAccountMessage('ok', '账号信息已更新');
    toast('账号信息已更新');
  } catch (err) {
    showAccountMessage('err', err.message);
  } finally {
    el.accountSave.disabled = false;
  }
}

function fillRemoteForm(system) {
  const remote = (system && system.remote) || {};
  el.remoteUrl.value = remote.url || '';
  el.remoteBranch.value = remote.branch || 'main';
  if (system && !system.git) {
    el.remoteStatus.textContent = '非 Git 仓库';
    el.remoteStatus.classList.remove('on');
    return;
  }
  el.remoteStatus.textContent = remote.url ? '已配置' : '未配置';
  el.remoteStatus.classList.toggle('on', !!remote.url);
}

function showRemoteMessage(kind, text) {
  el.remoteMessage.textContent = text;
  el.remoteMessage.className = `settings-message ${kind}`;
  el.remoteMessage.classList.remove('hidden');
}

async function saveRemote() {
  el.remoteSave.disabled = true;
  try {
    const res = await api('PUT', '/api/system/remote', {
      url: el.remoteUrl.value.trim(),
      branch: el.remoteBranch.value.trim(),
    });
    el.remoteUrl.value = res.remote.url || '';
    el.remoteBranch.value = res.remote.branch || 'main';
    el.remoteStatus.textContent = res.remote.url ? '已配置' : '未配置';
    el.remoteStatus.classList.toggle('on', !!res.remote.url);
    showRemoteMessage('ok', '仓库配置已保存');
    toast('仓库配置已保存');
  } catch (err) {
    showRemoteMessage('err', err.message);
  } finally {
    el.remoteSave.disabled = false;
  }
}

async function testRemote() {
  el.remoteTest.disabled = true;
  showRemoteMessage('info', '正在测试连接…');
  try {
    const res = await api('POST', '/api/system/remote/test');
    const detail = res.commit ? ` · ${res.commit}` : '';
    showRemoteMessage('ok', `连接成功（${res.branch}${detail}）`);
  } catch (err) {
    showRemoteMessage('err', err.message);
  } finally {
    el.remoteTest.disabled = false;
  }
}

function closeSettings() {
  el.settingsModal.classList.add('hidden');
}

async function saveSettings() {
  el.settingsSave.disabled = true;
  try {
    const res = await api('PUT', '/api/settings', readSettingsForm());
    state.r2Enabled = res.r2.enabled;
    fillSettingsForm(res.r2.values, res.r2.enabled, res.r2.hasSecret);
    syncStorageControls();
    showSettingsMessage('ok', '已保存');
    toast('设置已保存');
  } catch (err) {
    showSettingsMessage('err', err.message);
  } finally {
    el.settingsSave.disabled = false;
  }
}

async function testSettings() {
  el.settingsTest.disabled = true;
  showSettingsMessage('info', '正在测试连接…');
  try {
    await api('POST', '/api/settings/test', readSettingsForm());
    showSettingsMessage('ok', '连接成功，Bucket 可访问');
  } catch (err) {
    showSettingsMessage('err', err.message);
  } finally {
    el.settingsTest.disabled = false;
  }
}

el.settingsBtn.addEventListener('click', openSettings);
el.settingsClose.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', (e) => {
  if (e.target === el.settingsModal) closeSettings();
});
el.settingsSave.addEventListener('click', saveSettings);
el.settingsTest.addEventListener('click', testSettings);
el.remoteSave.addEventListener('click', saveRemote);
el.remoteTest.addEventListener('click', testRemote);
el.accountSave.addEventListener('click', saveAccount);

/* ------------------------------- update ------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let updatePollToken = 0;

function closeUpdate() {
  updatePollToken += 1;
  el.updateModal.classList.add('hidden');
}

async function startUpdate() {
  let info;
  try {
    info = await api('GET', '/api/system');
  } catch (err) {
    toast(err.message);
    return;
  }
  if (!info.git) {
    toast('部署目录不是 Git 仓库，无法自动更新');
    return;
  }
  if (info.update && info.update.status === 'running') {
    toast('已有更新任务正在进行');
    return;
  }
  if (
    !confirm('将从 Git 拉取最新代码并重启服务，期间页面会短暂断开。确定继续吗？')
  ) {
    return;
  }

  const token = (updatePollToken += 1);
  el.updateStep.textContent = '正在请求更新…';
  el.updateLog.textContent = '';
  el.updateDone.disabled = true;
  el.updateDone.textContent = '完成';
  el.updateModal.classList.remove('hidden');

  try {
    await api('POST', '/api/system/update');
  } catch (err) {
    if (token === updatePollToken) {
      el.updateStep.textContent = err.message || '更新请求失败';
      el.updateDone.disabled = false;
    }
    return;
  }
  pollUpdate(token);
}

async function pollUpdate(token) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (token === updatePollToken && Date.now() < deadline) {
    await sleep(2000);
    if (token !== updatePollToken) return;

    let data;
    try {
      data = await api('GET', '/api/system');
    } catch (err) {
      if (err.message === 'unauthorized') return;
      el.updateStep.textContent = '服务正在重启，等待重新连接…';
      continue;
    }

    const u = data.update || {};
    if (u.message) el.updateStep.textContent = u.message;
    if (u.logTail) el.updateLog.textContent = u.logTail;

    if (u.status === 'done') {
      el.updateStep.textContent = `更新完成（${u.fromVersion || '?'} → ${
        u.toVersion || '?'
      }）`;
      el.updateDone.disabled = false;
      el.updateDone.textContent = '刷新页面';
      toast('更新完成，正在刷新…');
      await sleep(1200);
      if (token === updatePollToken) location.reload();
      return;
    }
    if (u.status === 'failed') {
      el.updateStep.textContent = `更新失败：${u.error || u.message || '未知错误'}`;
      el.updateDone.disabled = false;
      return;
    }
    if (u.status === 'interrupted') {
      el.updateStep.textContent = u.message || '上次更新在重启过程中中断，请确认版本后重试';
      el.updateDone.disabled = false;
      return;
    }
  }
  if (token === updatePollToken) {
    el.updateStep.textContent = '更新状态未知，请手动刷新页面查看。';
    el.updateDone.disabled = false;
  }
}

el.updateBtn.addEventListener('click', startUpdate);
el.updateClose.addEventListener('click', closeUpdate);
el.updateDone.addEventListener('click', () => {
  if (el.updateDone.textContent === '刷新页面') location.reload();
  else closeUpdate();
});
el.updateModal.addEventListener('click', (e) => {
  if (e.target === el.updateModal) closeUpdate();
});

/* ----------------------------- drag & drop ---------------------------- */

let dragOrigin = null;
document.addEventListener(
  'mousedown',
  (e) => {
    dragOrigin = e.target;
  },
  true,
);

el.board.addEventListener('dragstart', (e) => {
  const origin = dragOrigin;
  dragOrigin = null;
  const nodeRow = e.target.closest('.node-row');
  if (nodeRow) {
    if (origin && origin.closest('button, input, textarea, a, .node-del')) {
      e.preventDefault();
      return;
    }
    nodeRow.classList.add('dragging');
    return;
  }
  const card = e.target.closest('.card');
  if (card) {
    if (!origin || !origin.closest('.card-head')) {
      e.preventDefault();
      return;
    }
    card.classList.add('dragging');
  }
});

el.board.addEventListener('dragover', (e) => {
  const draggingNode = el.board.querySelector('.node-row.dragging');
  if (draggingNode) {
    e.preventDefault();
    const target = e.target.closest('.node-row');
    if (!target || target === draggingNode) return;
    if (target.closest('.card') !== draggingNode.closest('.card')) return;
    const rect = target.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    target.parentNode.insertBefore(
      draggingNode,
      after ? target.nextSibling : target,
    );
    return;
  }
  const draggingCard = el.board.querySelector('.card.dragging');
  if (draggingCard) {
    e.preventDefault();
    const target = e.target.closest('.card');
    if (!target || target === draggingCard) return;
    const rect = target.getBoundingClientRect();
    const after = e.clientX - rect.left > rect.width / 2;
    el.board.insertBefore(draggingCard, after ? target.nextSibling : target);
  }
});

el.board.addEventListener('dragend', async () => {
  const draggingNode = el.board.querySelector('.node-row.dragging');
  if (draggingNode) {
    draggingNode.classList.remove('dragging');
    const card = draggingNode.closest('.card');
    const ids = [...card.querySelectorAll('.node-row')].map((r) =>
      Number(r.dataset.id),
    );
    try {
      await api('POST', '/api/nodes/reorder', { ids });
      await refresh();
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  const draggingCard = el.board.querySelector('.card.dragging');
  if (draggingCard) {
    draggingCard.classList.remove('dragging');
    const ids = [...el.board.querySelectorAll('.card')].map((c) =>
      Number(c.dataset.id),
    );
    try {
      await api('POST', '/api/tasks/reorder', { ids });
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
});

/* -------------------------------- init -------------------------------- */

boot();
