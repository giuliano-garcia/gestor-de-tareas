// ============================================
// GESTOR DE IMPRESIÓN TEXTIL 
// Arrays de objetos + DOM + CRUD + LocalStorage + OpenWeather
// ============================================

const STORAGE_KEY = 'gestor_impresion_data';
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12 MB de entrada (se comprime al guardar)

// ---------- Estado ----------
let state = {
  folders: [],
  files: [],
  tasks: [],
  currentFolderId: 'root',
  selectedItem: null,
  renameTarget: null,
  taskFileTarget: null,
  role: null // null = no logueado
};

// ---------- Utilidades ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      folders: state.folders,
      files: state.files,
      tasks: state.tasks
    }));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      alert('No hay más espacio de almacenamiento.\n\nProbá con imágenes más chicas o eliminá archivos que no uses.');
    } else {
      console.error('Error al guardar:', e);
      alert('Error al guardar los datos.');
    }
    throw e;
  }
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      state.folders = data.folders || [];
      state.files = data.files || [];
      state.tasks = data.tasks || [];
      // Limpiar tareas duplicadas (dejar solo una por archivo)
      const seen = new Set();
      state.tasks = state.tasks.filter(t => {
        if (!t.fileId) return true;
        if (seen.has(t.fileId)) return false;
        seen.add(t.fileId);
        return true;
      });
      // Eliminar tareas cuyo archivo ya no existe
      const fileIds = new Set(state.files.map(f => f.id));
      state.tasks = state.tasks.filter(t => !t.fileId || fileIds.has(t.fileId));
      save();
    } catch (e) {
      console.error('Error cargando datos', e);
    }
  }
}

function openModal(id) {
  $(`#${id}`).classList.add('open');
}

function closeModal(id) {
  $(`#${id}`).classList.remove('open');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Login / Roles ----------
function enterAs(role) {
  state.role = role;
  localStorage.setItem('gestor_role', role);

  $('#loginScreen').style.display = 'none';
  $('#app').style.display = 'flex';

  const isAdmin = role === 'admin';

  // UI según rol
  $('#adminActions').style.display = isAdmin ? 'flex' : 'none';
  $('#empleadoBadge').style.display = isAdmin ? 'none' : 'flex';
  $('#navDriveLabel').textContent = isAdmin ? 'Mis Archivos' : 'Archivos disponibles';

  // Label de rol
  const roleLabel = $('#currentRoleLabel');
  if (isAdmin) {
    roleLabel.innerHTML = '<i class="fas fa-user-shield"></i> <span>Administrador</span>';
    roleLabel.style.background = 'rgba(59, 130, 246, 0.15)';
    roleLabel.style.color = '#93c5fd';
  } else {
    roleLabel.innerHTML = '<i class="fas fa-user"></i> <span>Empleado</span>';
    roleLabel.style.background = 'rgba(16, 185, 129, 0.15)';
    roleLabel.style.color = '#6ee7b7';
  }

  // Tareas: solo admin las ve destacadas, pero empleado también puede ver
  // (admin ve filtro por defecto "activas")

  // Volver a vista drive
  $$('.nav-item').forEach(b => b.classList.remove('active'));
  $('#navDrive').classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#driveView').classList.add('active');

  state.currentFolderId = 'root';
  renderDrive();
  loadWeather();
}

$('#btnEnterAdmin').addEventListener('click', () => enterAs('admin'));
$('#btnEnterEmpleado').addEventListener('click', () => enterAs('empleado'));

function doLogout() {
  state.role = null;
  localStorage.removeItem('gestor_role');
  $('#app').style.display = 'none';
  $('#loginScreen').style.display = 'flex';
}
const btnLogout = $('#btnLogout');
if (btnLogout) btnLogout.addEventListener('click', doLogout);
const btnLogoutMobile = $('#btnLogoutMobile');
if (btnLogoutMobile) btnLogoutMobile.addEventListener('click', doLogout);

// ---------- Navegación de vistas ----------
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#${view}View`).classList.add('active');
    if (view === 'tasks') {
      // Admin por defecto ve activas
      const defaultFilter = 'all';
      $$('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === defaultFilter));
      renderTasks(defaultFilter);
    }
  });
});

// ---------- Breadcrumb ----------
function renderBreadcrumb() {
  const container = $('#breadcrumb');
  const path = [];
  let current = state.currentFolderId;

  while (current !== 'root') {
    const folder = state.folders.find(f => f.id === current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }

  let html = `<span class="crumb" data-id="root">Inicio</span>`;
  path.forEach(f => {
    html += `<span class="crumb" data-id="${f.id}">${escapeHtml(f.name)}</span>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => {
      state.currentFolderId = el.dataset.id;
      renderDrive();
    });
  });
}


function updateSummary() {
  const box = $('#adminSummary');
  if (!box) return;
  if (state.role !== 'admin' || state.currentFolderId !== 'root') {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'grid';
  // Contadores usando arrays de objetos
  const clientes = state.folders.filter(f => f.parentId === 'root').length;
  const archivos = state.files.length;
  const pendientes = state.tasks.filter(t => t.status === 'pendiente').length;
  const enProceso = state.tasks.filter(t => t.status === 'en_proceso').length;
  $('#sumClientes').textContent = clientes;
  $('#sumArchivos').textContent = archivos;
  $('#sumPendientes').textContent = pendientes;
  $('#sumEnProceso').textContent = enProceso;
}


// ---------- Buscador ----------
let searchQuery = '';
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderDrive();
    if ($('#tasksView').classList.contains('active')) {
      const f = $$('.filter-btn.active')[0]?.dataset.filter || 'all';
      renderTasks(f);
    }
  });
}

function matchesSearch(text) {
  if (!searchQuery) return true;
  return (text || '').toLowerCase().includes(searchQuery);
}

// ---------- Drive View ----------
function renderDrive() {
  renderBreadcrumb();
  const grid = $('#itemsGrid');
  const empty = $('#emptyState');

  let folders = state.folders.filter(f => f.parentId === state.currentFolderId);
  let files = state.files.filter(f => f.parentId === state.currentFolderId);
  if (searchQuery) {
    folders = folders.filter(f => matchesSearch(f.name));
    files = files.filter(f => matchesSearch(f.name));
  }

  if (folders.length === 0 && files.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    const hint = $('#emptyHint');
    if (hint) {
      if (state.currentFolderId === 'root') {
        hint.textContent = state.role === 'admin'
          ? 'Creá un cliente (carpeta) y subí sus pedidos'
          : 'El administrador todavía no cargó clientes';
      } else {
        hint.textContent = state.role === 'admin'
          ? 'Subí los archivos / pedidos de este cliente'
          : 'No hay pedidos cargados para este cliente';
      }
    }
    return;
  }

  empty.style.display = 'none';

  let html = '';

  folders.forEach(folder => {
    html += `
      <div class="item" data-type="folder" data-id="${folder.id}">
        <div class="item-icon folder"><i class="fas fa-folder"></i></div>
        <div class="item-name">${escapeHtml(folder.name)}</div>
        <div class="item-meta">Cliente</div>
      </div>`;
  });

  files.forEach(file => {
    const sizeKb = Math.round((file.data.length * 0.75) / 1024);
    const thumb = file.data
      ? `<div class="item-thumb"><img src="${file.data}" alt="${escapeHtml(file.name)}"></div>`
      : `<div class="item-icon file"><i class="fas fa-file-image"></i></div>`;
    
    // Fecha y hora de subida
    let fechaHora = '';
    if (file.createdAt) {
      const d = new Date(file.createdAt);
      fechaHora = d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }

    // Estado del pedido según tareas ligadas al archivo
    const task = state.tasks.find(t => t.fileId === file.id);
    const status = task ? task.status : 'pendiente';
    const statusLabel = status === 'en_proceso' ? 'En proceso' : (status === 'completada' ? 'Completada' : 'Pendiente');
    
    const downloadBtn = state.role === 'empleado'
      ? `<button class="btn-download-file" data-download="${file.id}" title="Descargar"><i class="fas fa-download"></i> Descargar</button>`
      : '';
    
    html += `
      <div class="item" data-type="file" data-id="${file.id}">
        ${thumb}
        <div class="item-name">${escapeHtml(file.name)}</div>
        <div class="item-meta">${sizeKb} KB · ${fechaHora}</div>
        <div class="item-meta"><span class="file-status status-${status}">${statusLabel}</span></div>
        ${downloadBtn}
      </div>`;
  });

  grid.innerHTML = html;

  grid.querySelectorAll('.item').forEach(el => {
    el.addEventListener('dblclick', () => {
      const type = el.dataset.type;
      const id = el.dataset.id;
      if (type === 'folder') {
        state.currentFolderId = id;
        renderDrive();
      } else {
        openEditor(id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, el.dataset.type, el.dataset.id);
    });
  });

  // Botón descargar (empleado)
  grid.querySelectorAll('[data-download]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFileAndMark(btn.dataset.download);
    });
  });
}

function downloadFileAndMark(fileId) {
  const file = state.files.find(f => f.id === fileId);
  if (!file) {
    alert('Archivo no encontrado');
    return;
  }

  // Descargar
  const link = document.createElement('a');
  link.href = file.data;
  link.download = file.name || 'archivo.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Marcar tarea como En proceso (o crear una si no existe)
  let task = state.tasks.find(t => t.fileId === fileId);
  if (!task) {
    let clientName = '';
    if (file.parentId && file.parentId !== 'root') {
      const folder = state.folders.find(f => f.id === file.parentId);
      if (folder) clientName = folder.name;
    }
    task = {
      id: uid(),
      name: file.name,
      fileId: fileId,
      fileName: file.name,
      clientName,
      priority: 'media',
      notes: '',
      status: 'en_proceso',
      createdAt: new Date().toISOString()
    };
    state.tasks.push(task);
  } else {
    task.status = 'en_proceso';
  }
  save();
  renderDrive();
  if ($('#tasksView').classList.contains('active')) {
    const f = $$('.filter-btn.active')[0]?.dataset.filter || 'all';
    renderTasks(f);
  }
}


// ---------- Context Menu ----------
let contextTarget = null;

function showContextMenu(e, type, id) {
  contextTarget = { type, id };
  const menu = $('#contextMenu');
  const isAdmin = state.role === 'admin';

  menu.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'flex' : 'none';
  });

  // Crear tarea solo en ARCHIVOS, nunca en carpetas
  const createTaskBtn = menu.querySelector('[data-action="create-task"]');
  if (createTaskBtn) {
    createTaskBtn.style.display = (isAdmin && type === 'file') ? 'flex' : 'none';
  }

  menu.classList.add('open');
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (e.pageX - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (e.pageY - rect.height) + 'px';
}

document.addEventListener('click', () => {
  $('#contextMenu').classList.remove('open');
});

$('#contextMenu').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !contextTarget) return;

  const action = btn.dataset.action;
  const { type, id } = contextTarget;
  const isAdmin = state.role === 'admin';

  if (action === 'open') {
    if (type === 'folder') {
      state.currentFolderId = id;
      renderDrive();
    } else {
      openEditor(id);
    }
  }

  if (action === 'rename' && isAdmin) {
    state.renameTarget = { type, id };
    const item = type === 'folder'
      ? state.folders.find(f => f.id === id)
      : state.files.find(f => f.id === id);
    $('#renameInput').value = item.name;
    openModal('modalRename');
  }

  if (action === 'delete' && isAdmin) {
    if (confirm('¿Estás seguro de que querés eliminar esto?')) {
      if (type === 'folder') {
        deleteFolderRecursive(id);
      } else {
        // Eliminar el archivo y sus tareas asociadas
        state.files = state.files.filter(f => f.id !== id);
        state.tasks = state.tasks.filter(t => t.fileId !== id);
      }
      save();
      renderDrive();
      renderTasks();
    }
  }

  if (action === 'create-task' && isAdmin) {
    if (type === 'file') {
      state.taskFileTarget = id;
      const file = state.files.find(f => f.id === id);
      let cliente = '';
      if (file && file.parentId && file.parentId !== 'root') {
        const folder = state.folders.find(f => f.id === file.parentId);
        if (folder) cliente = folder.name;
      }
      const pedido = file ? file.name.replace(/\.[^.]+$/, '') : 'Pedido';
      $('#taskNameInput').value = cliente ? `${cliente} - ${pedido}` : pedido;
      // Fecha por defecto: hoy + 3 días
      const d = new Date();
      d.setDate(d.getDate() + 3);
      $('#taskDueDate').value = d.toISOString().slice(0, 10);
      openModal('modalCreateTask');
    } else {
      alert('Solo se pueden crear tareas a partir de archivos.');
    }
  }

  $('#contextMenu').classList.remove('open');
});

function deleteFolderRecursive(folderId) {
  const children = state.folders.filter(f => f.parentId === folderId);
  children.forEach(c => deleteFolderRecursive(c.id));
  // Obtener IDs de archivos que se van a eliminar
  const fileIdsToDelete = state.files.filter(f => f.parentId === folderId).map(f => f.id);
  // Eliminar archivos
  state.files = state.files.filter(f => f.parentId !== folderId);
  // Eliminar tareas asociadas a esos archivos
  state.tasks = state.tasks.filter(t => !fileIdsToDelete.includes(t.fileId));
  // Eliminar la carpeta
  state.folders = state.folders.filter(f => f.id !== folderId);
}

// ---------- Nueva carpeta ----------
$('#btnNewFolder').addEventListener('click', () => {
  if (state.role !== 'admin') return;
  $('#folderNameInput').value = '';
  openModal('modalNewFolder');
  setTimeout(() => $('#folderNameInput').focus(), 50);
});

$('#btnCreateFolder').addEventListener('click', () => {
  if (state.role !== 'admin') return;
  const name = $('#folderNameInput').value.trim();
  if (!name) return alert('Ingresá un nombre para la carpeta');

  state.folders.push({
    id: uid(),
    name,
    parentId: state.currentFolderId,
    createdAt: new Date().toISOString()
  });
  save();
  closeModal('modalNewFolder');
  renderDrive();
  alert('Cliente "' + name + '" creado.');
});

// ---------- Subir archivos ----------

// Comprime imagen para que entre en LocalStorage
function compressImage(file, maxWidth = 2000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo cargar imagen'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG comprime mucho mejor que PNG para fotos
        const outType = (file.type === 'image/png' && !hasTransparencyGuess(file)) ? 'image/jpeg' : (file.type || 'image/jpeg');
        const mime = outType === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, quality);
        resolve({ dataUrl, width: w, height: h, mime });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function hasTransparencyGuess(file) {
  return (file.type || '') === 'image/png';
}

function setUploadStatus(msg, isError) {
  const el = $('#uploadStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#dc2626' : '#16a34a';
}

function processFiles(fileList) {
  console.log('processFiles llamado', fileList);
  const files = Array.from(fileList || []);
  
  // Siempre mostrar feedback visible
  setUploadStatus('Procesando ' + files.length + ' archivo(s)...');
  
  if (state.role !== 'admin') {
    setUploadStatus('Solo el administrador puede subir archivos', true);
    alert('Solo el administrador puede subir archivos.');
    return;
  }

  if (files.length === 0) {
    setUploadStatus('No se seleccionó ningún archivo', true);
    alert('No se seleccionó ningún archivo');
    return;
  }

  setUploadStatus('Subiendo ' + files.length + ' archivo(s)...');

  const btnUp = $('#btnUpload');
  if (btnUp) { btnUp.disabled = true; btnUp.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...'; }

  let uploaded = 0;
  const errors = [];

  (async () => {
    for (const file of files) {
      const name = (file.name || 'sin-nombre').toLowerCase();
      const type = (file.type || '').toLowerCase();

      const isImage = type.includes('png') || type.includes('jpeg') || type.includes('jpg') ||
                      type.includes('image') ||
                      name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') ||
                      name.endsWith('.webp');

      if (!isImage) {
        errors.push(file.name + ': no es imagen');
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(file.name + ': demasiado pesada (máx 12MB de entrada)');
        continue;
      }

      if (!file.size) {
        errors.push(file.name + ': archivo vacío');
        continue;
      }

      try {
        // Comprimir para que entre en LocalStorage (fotos de 4-8 MB pasan a mucho menos)
        const compressed = await compressImage(file, 2000, 0.72);
        // Si sigue siendo muy grande, comprimir más
        let final = compressed;
        if (final.dataUrl.length > 2.5 * 1024 * 1024) {
          final = await compressImage(file, 1400, 0.55);
        }
        if (final.dataUrl.length > 3.5 * 1024 * 1024) {
          final = await compressImage(file, 1000, 0.45);
        }

        let saveName = file.name;
        if (final.mime === 'image/jpeg' && !/\.jpe?g$/i.test(saveName)) {
          saveName = saveName.replace(/\.[^.]+$/, '') + '.jpg';
        }

        const fileId = uid();
        state.files.push({
          id: fileId,
          name: saveName,
          parentId: state.currentFolderId,
          type: final.mime,
          data: final.dataUrl,
          width: final.width,
          height: final.height,
          createdAt: new Date().toISOString()
        });
        uploaded++;
      } catch (err) {
        errors.push(file.name + ': ' + (err.message || 'error'));
        console.error(err);
      }
    }

    try {
      if (uploaded > 0) {
        save();
        renderDrive();
        setUploadStatus('✓ ' + uploaded + ' archivo(s) subido(s)');
      } else {
        setUploadStatus('No se subió ningún archivo', true);
      }
    } catch (e) {
      setUploadStatus('Error al guardar (poco espacio)', true);
    }

    if (errors.length) {
      setUploadStatus((uploaded ? uploaded + ' ok. ' : '') + 'Errores: ' + errors.join('; '), true);
    }

    if (btnUp) { btnUp.disabled = false; btnUp.innerHTML = '<i class="fas fa-upload"></i> Subir archivo'; }
    const input = $('#fileInput');
    if (input) input.value = '';
  })();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// ---------- Renombrar ----------
$('#btnConfirmRename').addEventListener('click', () => {
  if (state.role !== 'admin') return;
  const name = $('#renameInput').value.trim();
  if (!name || !state.renameTarget) return;

  const { type, id } = state.renameTarget;
  if (type === 'folder') {
    const folder = state.folders.find(f => f.id === id);
    if (folder) folder.name = name;
  } else {
    const file = state.files.find(f => f.id === id);
    if (file) file.name = name;
  }
  save();
  closeModal('modalRename');
  renderDrive();
});

// ---------- Crear tarea ----------
$('#btnConfirmCreateTask').addEventListener('click', () => {
  if (state.role !== 'admin') return;
  const name = $('#taskNameInput').value.trim();
  if (!name) return alert('Ingresá un nombre para la tarea');

  const file = state.files.find(f => f.id === state.taskFileTarget);

  let clientName = '';
  if (file && file.parentId && file.parentId !== 'root') {
    const folder = state.folders.find(f => f.id === file.parentId);
    if (folder) clientName = folder.name;
  }

  // Si ya existe una tarea para este archivo, actualizarla en vez de crear otra
  let existing = state.tasks.find(t => t.fileId === state.taskFileTarget);
  if (existing) {
    existing.name = name;
    existing.fileName = file ? file.name : existing.fileName;
    existing.clientName = clientName;
    existing.dueDate = $('#taskDueDate').value || '';
    existing.notes = $('#taskNotes').value.trim();
  } else {
    state.tasks.push({
      id: uid(),
      name,
      fileId: state.taskFileTarget,
      fileName: file ? file.name : '',
      clientName,
      dueDate: $('#taskDueDate').value || '',
      notes: $('#taskNotes').value.trim(),
      status: 'pendiente',
      createdAt: new Date().toISOString()
    });
  }

  save();
  closeModal('modalCreateTask');
  alert('Tarea creada correctamente.');
  // Quedarse en la vista actual (no redirigir a tareas)
  renderDrive();
});

// ---------- Tareas ----------
function renderTasks(filter = 'all') {
  const list = $('#tasksList');
  let tasks = [...state.tasks];

  if (filter === 'pendiente') {
    tasks = tasks.filter(t => t.status === 'pendiente');
  } else if (filter === 'en_proceso') {
    tasks = tasks.filter(t => t.status === 'en_proceso');
  } else {
    tasks = tasks.filter(t => t.status === 'pendiente' || t.status === 'en_proceso');
  }

  // Buscador
  if (searchQuery) {
    tasks = tasks.filter(t =>
      matchesSearch(t.clientName) ||
      matchesSearch(t.name) ||
      matchesSearch(t.fileName) ||
      matchesSearch(t.notes)
    );
  }

  const orderStatus = { pendiente: 0, en_proceso: 1, completada: 2 };
  tasks.sort((a, b) => {
    const ca = (a.clientName || 'Sin cliente').localeCompare(b.clientName || 'Sin cliente');
    if (ca !== 0) return ca;
    const sa = orderStatus[a.status] ?? 9;
    const sb = orderStatus[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.name || '').localeCompare(b.name || '');
  });

  if (tasks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-tasks"></i>
        <p>No hay tareas${searchQuery ? ' que coincidan' : ''}</p>
        <p class="hint">${state.role === 'admin' ? 'Creá una tarea con clic derecho sobre un archivo' : 'Cuando haya pedidos aparecerán aquí'}</p>
      </div>`;
    return;
  }

  const byClient = {};
  const clientOrder = [];
  tasks.forEach(t => {
    const key = t.clientName || 'Sin cliente';
    if (!byClient[key]) {
      byClient[key] = [];
      clientOrder.push(key);
    }
    byClient[key].push(t);
  });

  const statusLabel = (s) => s === 'en_proceso' ? 'En proceso' : (s === 'completada' ? 'Completada' : 'Pendiente');

  function formatDate(d) {
    if (!d) return '';
    try {
      const [y, m, day] = d.split('-');
      return `${day}/${m}/${y}`;
    } catch { return d; }
  }

  let html = `
    <div class="pedidos-table">
      <div class="pedidos-head">
        <span>Cliente / Pedido</span>
        <span>Estado</span>
        <span>Fecha límite</span>
      </div>
  `;

  clientOrder.forEach((cliente, idx) => {
    html += `
      <div class="pedidos-client">
        <div class="pedidos-client-title">${escapeHtml(cliente)}</div>
    `;
    byClient[cliente].forEach(task => {
      let pedidoName = task.fileName || task.name || 'Pedido';
      pedidoName = pedidoName.replace(/^Impresión\s*-\s*/i, '');
      const due = formatDate(task.dueDate);
      const notes = task.notes ? `<div class="pedidos-notes">${escapeHtml(task.notes)}</div>` : '';
      html += `
        <div class="pedidos-line">
          <span class="pedidos-name">${escapeHtml(pedidoName)}${notes}</span>
          <span class="pedidos-estado status-${task.status}">${statusLabel(task.status)}</span>
          <span class="pedidos-fecha">${due || '—'}</span>
        </div>`;
    });
    html += `</div>`;
    if (idx < clientOrder.length - 1) {
      html += `<div class="pedidos-separator"></div>`;
    }
  });

  html += `</div>`;
  list.innerHTML = html;
}

$$('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTasks(btn.dataset.filter);
  });
});

window.openTaskFile = (fileId) => {
  const file = state.files.find(f => f.id === fileId);
  if (file) openEditor(fileId);
  else alert('El archivo ya no existe');
};

window.cycleTaskStatus = (taskId) => {
  if (state.role !== 'admin') return;
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const order = ['pendiente', 'en_proceso', 'completada'];
  const next = (order.indexOf(task.status) + 1) % order.length;
  task.status = order[next];
  save();
  const activeFilter = $$('.filter-btn.active')[0]?.dataset.filter || 'all';
  renderTasks(activeFilter);
};

window.completeTask = (taskId) => {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.status = 'completada';
  save();
  const activeFilter = $$('.filter-btn.active')[0]?.dataset.filter || 'all';
  renderTasks(activeFilter);
};

window.deleteTask = (taskId) => {
  if (state.role !== 'admin') return;
  if (!confirm('¿Eliminar esta tarea?')) return;
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  save();
  const activeFilter = $$('.filter-btn.active')[0]?.dataset.filter || 'all';
  renderTasks(activeFilter);
};

// ---------- Editor de selección ----------
let editorState = {
  fileId: null,
  img: null,
  scale: 1,
  isSelecting: false,
  startX: 0,
  startY: 0,
  sel: null
};

const canvas = $('#mainCanvas');
const ctx = canvas.getContext('2d');
const selectionBox = $('#selectionBox');

async function openEditor(fileId) {
  const file = state.files.find(f => f.id === fileId);
  if (!file) return;

  editorState.fileId = fileId;
  $('#editorFileName').textContent = file.name;
  $('#btnExportSelection').disabled = true;
  selectionBox.style.display = 'none';
  editorState.sel = null;

  const img = await loadImage(file.data);
  editorState.img = img;

  const maxW = window.innerWidth - 320;
  const maxH = window.innerHeight - 100;
  let scale = 1;
  if (img.width > maxW || img.height > maxH) {
    scale = Math.min(maxW / img.width, maxH / img.height);
  }
  editorState.scale = scale;

  canvas.width = img.width * scale;
  canvas.height = img.height * scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const dpi = 96;
  const cmW = ((img.width / dpi) * 2.54).toFixed(1);
  const cmH = ((img.height / dpi) * 2.54).toFixed(1);
  $('#docWidth').textContent = `${cmW} cm`;
  $('#docHeight').textContent = `${cmH} cm`;
  $('#selWidth').textContent = '—';
  $('#selHeight').textContent = '—';

  $('#editorOverlay').classList.add('open');
}

$('#btnCancelEdit').addEventListener('click', () => {
  $('#editorOverlay').classList.remove('open');
});

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  editorState.isSelecting = true;
  editorState.startX = e.clientX - rect.left;
  editorState.startY = e.clientY - rect.top;
  editorState.sel = null;
  selectionBox.style.display = 'none';
  $('#btnExportSelection').disabled = true;
});

canvas.addEventListener('mousemove', (e) => {
  if (!editorState.isSelecting) return;
  const rect = canvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  const x = Math.min(editorState.startX, currentX);
  const y = Math.min(editorState.startY, currentY);
  const w = Math.abs(currentX - editorState.startX);
  const h = Math.abs(currentY - editorState.startY);

  const containerRect = $('#canvasContainer').getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  selectionBox.style.display = 'block';
  selectionBox.style.left = (canvasRect.left - containerRect.left + x) + 'px';
  selectionBox.style.top = (canvasRect.top - containerRect.top + y) + 'px';
  selectionBox.style.width = w + 'px';
  selectionBox.style.height = h + 'px';

  editorState.sel = { x, y, w, h };
  updateSelectionMeasures();
});

canvas.addEventListener('mouseup', () => {
  if (!editorState.isSelecting) return;
  editorState.isSelecting = false;
  if (editorState.sel && editorState.sel.w > 5 && editorState.sel.h > 5) {
    $('#btnExportSelection').disabled = false;
  } else {
    selectionBox.style.display = 'none';
    editorState.sel = null;
    $('#btnExportSelection').disabled = true;
  }
});

function updateSelectionMeasures() {
  if (!editorState.sel || !editorState.img) return;
  const { w, h } = editorState.sel;
  const scale = editorState.scale;
  const realW = w / scale;
  const realH = h / scale;
  const dpi = 96;
  const cmW = ((realW / dpi) * 2.54).toFixed(1);
  const cmH = ((realH / dpi) * 2.54).toFixed(1);
  $('#selWidth').textContent = `${cmW} cm`;
  $('#selHeight').textContent = `${cmH} cm`;
}

// Exportar selección → automáticamente pasa la tarea a "en_proceso"
$('#btnExportSelection').addEventListener('click', () => {
  if (!editorState.sel || !editorState.img) return;

  const { x, y, w, h } = editorState.sel;
  const scale = editorState.scale;

  const rx = Math.round(x / scale);
  const ry = Math.round(y / scale);
  const rw = Math.round(w / scale);
  const rh = Math.round(h / scale);

  const temp = document.createElement('canvas');
  temp.width = rw;
  temp.height = rh;
  const tctx = temp.getContext('2d');
  tctx.drawImage(editorState.img, rx, ry, rw, rh, 0, 0, rw, rh);

  const link = document.createElement('a');
  const file = state.files.find(f => f.id === editorState.fileId);
  const baseName = file ? file.name.replace(/\.[^.]+$/, '') : 'pieza';
  link.download = `${baseName}_seleccion.png`;
  link.href = temp.toDataURL('image/png');
  link.click();

  // >>> Automático: pasar tareas relacionadas a "en_proceso"
  const relatedTasks = state.tasks.filter(t => t.fileId === editorState.fileId && t.status === 'pendiente');
  if (relatedTasks.length > 0) {
    relatedTasks.forEach(t => {
      t.status = 'en_proceso';
    });
    save();
  }
});

// ---------- Cerrar modales ----------
$$('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal.open').forEach(m => m.classList.remove('open'));
    if ($('#editorOverlay').classList.contains('open')) {
      $('#editorOverlay').classList.remove('open');
    }
  }
});

// ---------- OpenWeather (Open-Meteo) ----------
async function loadWeather() {
  const widget = $('#weatherWidget');
  if (!widget) return;

  function showWeather(lat, lon, cityName) {
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
      .then(r => r.json())
      .then(data => {
        const temp = Math.round(data.current_weather.temperature);
        const code = data.current_weather.weathercode;
        const desc = weatherCodeToText(code);
        widget.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div>
              <div class="temp">${temp}°C</div>
              <div class="desc">${desc}</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:4px;">${cityName}</div>
            </div>
          </div>
        `;
      })
      .catch(() => {
        widget.innerHTML = `<div style="color:#94a3b8;font-size:0.85rem;"><i class="fas fa-cloud"></i> Clima no disponible</div>`;
      });
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(2);
        const lon = pos.coords.longitude.toFixed(2);
        showWeather(lat, lon, 'Tu ubicación');
      },
      () => {
        // Fallback Buenos Aires
        showWeather(-34.60, -58.38, 'Buenos Aires');
      },
      { timeout: 5000 }
    );
  } else {
    showWeather(-34.60, -58.38, 'Buenos Aires');
  }
}

function weatherCodeToText(code) {
  const map = {
    0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado',
    3: 'Nublado', 45: 'Niebla', 48: 'Niebla', 51: 'Llovizna',
    61: 'Lluvia', 63: 'Lluvia moderada', 65: 'Lluvia fuerte',
    71: 'Nieve', 80: 'Chubascos', 95: 'Tormenta'
  };
  return map[code] || 'Variable';
}

// ---------- Inicialización ----------
load();
// Siempre mostrar pantalla de login al abrir
$('#loginScreen').style.display = 'flex';
$('#app').style.display = 'none';

// Enlazar input de archivos una sola vez
function bindFileInput() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  // Evitar múltiples listeners
  input.onchange = function(e) {
    processFiles(e.target.files);
  };

  const btn = document.getElementById('btnUpload');
  if (btn) {
    btn.onclick = function() {
      if (state.role !== 'admin') {
        alert('Solo el administrador puede subir archivos.');
        return;
      }
      input.click();
    };
  }
}
bindFileInput();
