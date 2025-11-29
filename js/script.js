// Estado de la aplicación
let estado = {
    seccionActual: 'inicio',
    articuloActual: null,
    modoTraduccion: false
};

// Array para almacenar los artículos (se cargará desde JSON)
let articulos = [];
// Configuración opcional para backend remoto (se carga desde `config.json` si existe)
let remoteConfig = null;
// Queue for failed sync attempts (retry mechanism)
let syncQueue = [];
// Track if a sync is currently in progress
let activeSyncCount = 0;

// Elementos DOM
const vistaPrincipal = document.getElementById('vista-principal');
const vistaArticulo = document.getElementById('vista-articulo');
const modalBueno = document.getElementById('modal-bueno');
const botonRegresar = document.getElementById('boton-regresar');
const botonTraduccion = document.getElementById('boton-traduccion');
const botonBueno = document.getElementById('boton-bueno');
const botonConfirmarBueno = document.getElementById('confirmar-bueno');
const botonCancelarBueno = document.getElementById('cancelar-bueno');
const nombreBuenoInput = document.getElementById('nombre-bueno');
const verTodoBoton = document.getElementById('ver-todo');
const mensajeConfirmacion = document.getElementById('mensaje-confirmacion');

// Función para generar slug URL-friendly desde el título
function generarSlug(titulo) {
    return titulo
        .toLowerCase()
        .trim()
        .replace(/<[^>]*>/g, '') // Remover etiquetas HTML
        .normalize('NFD') // Descomponer caracteres acentuados
        .replace(/[\u0300-\u036f]/g, '') // Remover acentos
        .replace(/[^\w\s\-]/g, '') // Remover caracteres especiales
        .replace(/\s+/g, '-') // Reemplazar espacios con guiones
        .replace(/-+/g, '-') // Remover guiones múltiples
        .replace(/^-+|-+$/g, '') // Remover guiones al inicio/final
        .substring(0, 50); // Limitar a 50 caracteres
}

// Función para cargar artículos desde JSON
async function cargarArticulos() {
    try {
        mostrarLoading();
        
        const response = await fetch('data/articles.json');
        if (!response.ok) {
            throw new Error('No se pudieron cargar los artículos');
        }
        articulos = await response.json();
        // Cargar archivo de configuración opcional (config.json) para backend remoto
        await cargarConfig();

        // Cargar los "buenos" desde localStorage después de cargar los artículos
        cargarBuenos();

        // Si hay backend remoto configurado, intentar cargar valores remotos y mezclarlos
        if (remoteConfig && remoteConfig.supabaseUrl && remoteConfig.supabaseAnonKey) {
            await cargarBuenosRemotos();
        }

        // Precargar imágenes para mejor experiencia
        setTimeout(() => {
            precargarImagenes();
        }, 1000);
        
        // Ocultar loading y mostrar contenido
        ocultarLoading();
        
        // Inicializar la aplicación
        inicializarApp();
        
        // Verificar si hay un artículo en la URL y mostrarlo
        verificarUrlArticulo();
        
    } catch (error) {
        console.error('Error cargando artículos:', error);
        mostrarError('Error al cargar el contenido. Por favor, recarga la página.');
    }
}

// Función para verificar si hay un artículo en la URL y mostrarlo
function verificarUrlArticulo() {
    const hash = window.location.hash.slice(1); // Remover el #
    if (!hash) return;
    
    // Verificar si contiene un slash (formato: seccion/articulo-slug)
    if (hash.includes('/')) {
        const [seccion, slug] = hash.split('/');
        // Buscar el artículo por slug
        const articulo = articulos.find(art => generarSlug(art.titulo) === slug && art.seccion === seccion);
        if (articulo) {
            mostrarArticulo(articulo.id);
        }
        return;
    }
    
    // Verificar si es una sección válida
    const secciones = ['todo', 'cuento-novela', 'poesia', 'cine', 'literatura', 'ensayo', 'notas-personales'];
    if (secciones.includes(hash)) {
        cambiarSeccion(hash);
        return;
    }
    
    // Buscar el artículo por ID o slug (compatibilidad con URLs antiguas)
    let articulo = null;
    
    // Primero intentar por ID (si es un número)
    if (/^\d+$/.test(hash)) {
        const id = parseInt(hash);
        articulo = articulos.find(art => art.id === id);
    } else {
        // Si no, buscar por slug
        articulo = articulos.find(art => generarSlug(art.titulo) === hash);
    }
    
    if (articulo) {
        mostrarArticulo(articulo.id);
    }
}

// Función para manejar cambios en la URL (cuando el usuario usa botones de navegación del navegador)
function manejarCambioHash() {
    verificarUrlArticulo();
}

function mostrarLoading() {
    // Add a non-destructive loading overlay so we don't remove the page DOM
    if (document.getElementById('loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>Cargando contenido...</p>
        </div>
    `;
    const contenedor = document.getElementById('vista-principal') || document.body;
    contenedor.appendChild(overlay);
}

function ocultarLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.remove();
}

function mostrarError(mensaje) {
    const contenedor = document.getElementById('vista-principal');
    contenedor.innerHTML = `
        <div class="error">
            <h2>Error</h2>
            <p>${mensaje}</p>
            <button onclick="location.reload()" class="boton">Recargar página</button>
        </div>
    `;
}

// Función para guardar los "buenos" de un artículo específico en localStorage
function guardarBuenoEnLocalStorage(articulo) {
    localStorage.setItem(`articulo_${articulo.id}_buenos`, articulo.buenos);
    localStorage.setItem(`articulo_${articulo.id}_nombres`, JSON.stringify(articulo.nombresBuenos));
}

// Cargar archivo de configuración opcional `config.json` si existe.
async function cargarConfig() {
    try {
        const resp = await fetch('config.json');
        if (!resp.ok) {
            // No hay config, silently continue
            return;
        }
        remoteConfig = await resp.json();
    } catch (e) {
        console.warn('No se pudo cargar config.json (si no existe, no es un error).', e);
    }
}

// Cargar "buenos" desde un backend Supabase (opcional). Mezcla valores con localStorage.
async function cargarBuenosRemotos() {
    if (!remoteConfig || !remoteConfig.supabaseUrl || !remoteConfig.supabaseAnonKey) return;
    const urlBase = remoteConfig.supabaseUrl.replace(/\/$/, '');
    const headers = {
        'apikey': remoteConfig.supabaseAnonKey,
        'Authorization': `Bearer ${remoteConfig.supabaseAnonKey}`
    };
    try {
        // Fetch all public counters in one request
        const res = await fetch(`${urlBase}/rest/v1/buenos_public?select=article_id,buenos`, { headers });
        if (!res.ok) return;
        const rows = await res.json();
        const map = {};
        rows.forEach(r => { map[Number(r.article_id)] = r.buenos; });
        articulos.forEach(art => {
            if (map[art.id] != null) {
                art.buenos = map[art.id];
            }
        });
    } catch (e) {
        console.warn('Error cargando buenos remotos', e);
    }
}

// Guardar/actualizar contador "buenos" en backend Supabase (opcional). Falls back silently.
async function guardarBuenoRemoto(articulo) {
    if (!remoteConfig || !remoteConfig.supabaseUrl || !remoteConfig.supabaseAnonKey) return;
    const urlBase = remoteConfig.supabaseUrl.replace(/\/$/, '');
    const headers = {
        'apikey': remoteConfig.supabaseAnonKey,
        'Authorization': `Bearer ${remoteConfig.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };

    try {
        // Upsert public counter in `buenos_public` table
        const getRes = await fetch(`${urlBase}/rest/v1/buenos_public?article_id=eq.${encodeURIComponent(articulo.id)}&select=*`, { headers });
        if (!getRes.ok) {
            console.warn('Error al consultar fila remota', getRes.status);
            return;
        }
        const rows = await getRes.json();
        const payload = {
            article_id: articulo.id,
            buenos: articulo.buenos || 0
        };

        if (rows && rows.length > 0) {
            const rowId = rows[0].id;
            await fetch(`${urlBase}/rest/v1/buenos_public?id=eq.${rowId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(payload)
            });
        } else {
            await fetch(`${urlBase}/rest/v1/buenos_public`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
        }
    } catch (e) {
        console.warn('Error guardando buenos remotamente', e);
    }
}

// Enviar nombre a endpoint privado (Edge Function) para almacenamiento seguro
async function enviarNombrePrivado(articulo, nombre) {
    if (!remoteConfig || !remoteConfig.privateEndpoint) return;
    try {
        await fetch(remoteConfig.privateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article_id: articulo.id, nombre })
        });
    } catch (e) {
        console.warn('No se pudo enviar el nombre al endpoint privado', e);
    }
}

// Función para cargar los "buenos" desde localStorage
function cargarBuenos() {
    articulos.forEach(art => {
        const guardadosBuenos = localStorage.getItem(`articulo_${art.id}_buenos`);
        const guardadosNombres = localStorage.getItem(`articulo_${art.id}_nombres`);

        if (guardadosBuenos !== null) {
            art.buenos = parseInt(guardadosBuenos);
        }
        if (guardadosNombres !== null) {
            try {
                art.nombresBuenos = JSON.parse(guardadosNombres);
            } catch(e) {
                console.warn('Error parseando nombres buenos:', e);
            }
        }
    });
}

// Función para manejar el contador de visitas
function actualizarContadorVisitas() {
    let visitas = localStorage.getItem('visitas');
    if (!visitas) {
        visitas = 0;
    } else {
        visitas = parseInt(visitas, 10) || 0;
    }
    
    visitas++;
    localStorage.setItem('visitas', visitas);
}

// Inicialización de la aplicación
function inicializarApp() {
    // Configurar navegación
    document.querySelectorAll('nav a').forEach(enlace => {
        enlace.addEventListener('click', function(e) {
            e.preventDefault();
            const seccion = this.getAttribute('data-seccion');
            if (seccion) cambiarSeccion(seccion);
        });
    });

    // Hacer que al clicar el logo regrese al inicio
    const logo = document.querySelector('.logo');
    if (logo) {
        logo.addEventListener('click', function(e) {
            e.preventDefault();
            cambiarSeccion('inicio');
        });
    }

    // Configurar botones
    botonRegresar.addEventListener('click', volverAPrincipal);
    botonTraduccion.addEventListener('click', alternarTraduccion);
    botonBueno.addEventListener('click', mostrarModalBueno);
    botonConfirmarBueno.addEventListener('click', registrarBueno);
    botonCancelarBueno.addEventListener('click', cerrarModalBueno);

    verTodoBoton.addEventListener('click', function(e) {
        e.preventDefault();
        cambiarSeccion('todo');
    });

    // Warn user if they try to leave while sync is in progress
    window.addEventListener('beforeunload', function(e) {
        if (activeSyncCount > 0) {
            e.preventDefault();
            e.returnValue = 'Se está registrando tu afirmación. ¿Estás seguro de que quieres irte?';
            return e.returnValue;
        }
    });

    // Escuchar cambios en el hash (navegación del navegador)
    window.addEventListener('hashchange', manejarCambioHash);

    // Cargar contenido inicial
    cargarSeccionInicio();
}

// Funciones de navegación
function cambiarSeccion(seccion) {
    // Si la sección no existe, salir
    const target = document.getElementById(seccion);
    if (!target) return;

    // Ocultar todas las secciones
    document.querySelectorAll('.seccion').forEach(sec => {
        sec.classList.add('oculto');
    });

    // Mostrar la sección seleccionada
    target.classList.remove('oculto');
    estado.seccionActual = seccion;

    // Actualizar la URL con la sección (excepto para 'inicio')
    if (seccion !== 'inicio') {
        history.replaceState(null, '', `#${seccion}`);
    } else {
        history.replaceState(null, '', ' ');
    }

    // Cargar contenido según la sección
    if (seccion === 'inicio') {
        cargarSeccionInicio();
    } else if (seccion === 'todo') {
        cargarSeccionTodo();
    } else {
        cargarSeccionEspecifica(seccion);
    }

    // Asegurarnos de mostrar la vista principal (si veníamos desde un artículo)
    vistaArticulo.classList.add('oculto');
    vistaPrincipal.classList.remove('oculto');
}

function cargarSeccionInicio() {
    const contenedor = document.querySelector('#grid-destacados');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    
    const destacados = articulos.filter(art => art.destacado);
    
    destacados.forEach(articulo => {
        contenedor.appendChild(crearTarjetaArticulo(articulo, true));
    });
}

function cargarSeccionTodo() {
    const contenedor = document.querySelector('#lista-todo');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    
    // Ordenar por fecha (más reciente primero)
    const articulosOrdenados = [...articulos].sort((a, b) => {
        return new Date(b.fecha) - new Date(a.fecha);
    });
    
    articulosOrdenados.forEach(articulo => {
        contenedor.appendChild(crearArticuloLista(articulo));
    });
}

function cargarSeccionEspecifica(seccion) {
    const contenedor = document.querySelector(`#${seccion} .lista-articulos`);
    if (!contenedor) return;
    contenedor.innerHTML = '';
    
    const articulosSeccion = articulos.filter(art => art.seccion === seccion);
    
    // Ordenar por fecha (más reciente primero)
    const articulosOrdenados = [...articulosSeccion].sort((a, b) => {
        return new Date(b.fecha) - new Date(a.fecha);
    });
    
    articulosOrdenados.forEach(articulo => {
        contenedor.appendChild(crearArticuloLista(articulo));
    });
}

function crearTarjetaArticulo(articulo, esInicio) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'articulo-card';
    
    // Solo agregar imagen si existe
    if (articulo.imagen) {
        const img = document.createElement('img');
        img.src = articulo.imagen;
        img.alt = articulo.titulo;
        img.loading = "lazy";
        img.addEventListener('load', function() {
            this.classList.add('loaded');
        });
        img.addEventListener('click', function(e) {
            e.preventDefault();
            mostrarArticulo(articulo.id);
        });
        tarjeta.appendChild(img);
    }

    const h3 = document.createElement('h3');
    h3.innerHTML = articulo.titulo;
    h3.addEventListener('click', function(e) {
        e.preventDefault();
        mostrarArticulo(articulo.id);
    });
    tarjeta.appendChild(h3);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Por ${articulo.autor} | ${articulo.fechaDisplay}`;
    tarjeta.appendChild(meta);

    if (articulo.resumen) {
        const resumen = document.createElement('div');
        resumen.className = 'resumen';
        resumen.innerHTML = articulo.resumen;
        tarjeta.appendChild(resumen);
    }

    if (!esInicio) {
        const leer = document.createElement('a');
        leer.href = '#';
        leer.className = 'leer-mas';
        leer.textContent = 'Leer';
        leer.addEventListener('click', function(e) {
            e.preventDefault();
            mostrarArticulo(articulo.id);
        });
        tarjeta.appendChild(leer);
    }

    return tarjeta;
}

function crearArticuloLista(articulo) {
    const item = document.createElement('div');
    
    // Agregar clase especial cuando no hay imagen
    if (articulo.imagen) {
        item.className = 'articulo-lista';
    } else {
        item.className = 'articulo-lista sin-imagen';
    }
    
    if (articulo.imagen) {
        const contImg = document.createElement('div');
        contImg.className = 'imagen-contenedor';
        const img = document.createElement('img');
        img.src = articulo.imagen;
        img.alt = articulo.titulo;
        img.loading = "lazy";
        img.addEventListener('load', function() {
            this.classList.add('loaded');
        });
        img.addEventListener('click', function(e) {
            e.preventDefault();
            mostrarArticulo(articulo.id);
        });
        contImg.appendChild(img);
        item.appendChild(contImg);
    }
    
    const contenido = document.createElement('div');
    contenido.className = 'contenido';

    const h3 = document.createElement('h3');
    h3.innerHTML = articulo.titulo;
    h3.addEventListener('click', function(e) {
        e.preventDefault();
        mostrarArticulo(articulo.id);
    });
    contenido.appendChild(h3);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Por ${articulo.autor} | ${articulo.fechaDisplay}`;
    contenido.appendChild(meta);

    if (articulo.resumen) {
        const resumen = document.createElement('div');
        resumen.className = 'resumen';
        resumen.innerHTML = articulo.resumen;
        contenido.appendChild(resumen);
    }

    const leer = document.createElement('a');
    leer.href = '#';
    leer.className = 'leer-lista';
    leer.textContent = 'Leer';
    leer.addEventListener('click', function(e) {
        e.preventDefault();
        mostrarArticulo(articulo.id);
    });
    contenido.appendChild(leer);

    item.appendChild(contenido);
    return item;
}

function mostrarArticulo(id) {
    const articulo = articulos.find(art => art.id === id);
    if (!articulo) return;
    
    estado.articuloActual = articulo;
    estado.modoTraduccion = false;
    
    // Actualizar la URL con el slug del artículo (formato: seccion/articulo-slug)
    const slug = generarSlug(articulo.titulo);
    history.replaceState(null, '', `#${articulo.seccion}/${slug}`);
    
    // Actualizar contenido del artículo
    document.getElementById('titulo-articulo').innerHTML = articulo.titulo;
    document.getElementById('autor-articulo').textContent = articulo.autor;
    document.getElementById('fecha-articulo').textContent = articulo.fechaDisplay;
    document.getElementById('contenido-articulo').innerHTML = articulo.contenido;
    document.getElementById('contenido-traduccion').innerHTML = articulo.traduccion || '';
    
    // Mostrar/ocultar imagen
    const imagenArticulo = document.getElementById('imagen-articulo');
    if (articulo.imagen) {
        imagenArticulo.src = articulo.imagen;
        imagenArticulo.classList.remove('oculto');
        imagenArticulo.classList.remove('loaded');
        
        // Cargar imagen con fade-in
        imagenArticulo.addEventListener('load', function() {
            this.classList.add('loaded');
        });
        
        // Agregar evento de clic a la imagen del artículo
        imagenArticulo.addEventListener('click', function() {
            window.open(articulo.imagen, '_blank');
        });
    } else {
        imagenArticulo.classList.add('oculto');
    }
    
    // Actualizar contador de "está bueno"
    actualizarContadorBueno(articulo);
    
    // Ocultar traducción inicialmente
    document.getElementById('contenido-traduccion').classList.add('oculto');
    document.getElementById('contenido-articulo').classList.remove('oculto');
    document.getElementById('boton-traduccion').textContent = 'Traducción';
    estado.modoTraduccion = false;
    
    // Cambiar a vista de artículo
    vistaPrincipal.classList.add('oculto');
    vistaArticulo.classList.remove('oculto');
}

function volverAPrincipal() {
    vistaArticulo.classList.add('oculto');
    vistaPrincipal.classList.remove('oculto');
    // Volver a la sección que estaba activa
    cambiarSeccion('inicio');
}

function alternarTraduccion() {
    if (!estado.articuloActual) return;
    estado.modoTraduccion = !estado.modoTraduccion;
    
    if (estado.modoTraduccion) {
        document.getElementById('contenido-articulo').classList.add('oculto');
        document.getElementById('contenido-traduccion').classList.remove('oculto');
        document.getElementById('boton-traduccion').textContent = 'Regresar a original';
    } else {
        document.getElementById('contenido-articulo').classList.remove('oculto');
        document.getElementById('contenido-traduccion').classList.add('oculto');
        document.getElementById('boton-traduccion').textContent = 'Traducción';
    }
}

function mostrarModalBueno() {
    if (!estado.articuloActual) return;
    modalBueno.style.display = 'flex';
    nombreBuenoInput.value = '';
    nombreBuenoInput.focus();
}

function cerrarModalBueno() {
    modalBueno.style.display = 'none';
}

async function registrarBueno() {
    const nombre = nombreBuenoInput.value.trim();
    
    if (nombre.length === 0) {
        alert('Por favor, ingresa al menos un carácter para tu nombre.');
        return;
    }
    
    if (nombre.length > 300) {
        alert('El nombre no puede tener más de 300 caracteres.');
        return;
    }

    // Disable the confirm button to prevent double-clicks
    botonConfirmarBueno.disabled = true;
    
    // Actualizar el artículo en el array original
    const idx = articulos.findIndex(a => a.id === estado.articuloActual.id);
    if (idx === -1) {
        botonConfirmarBueno.disabled = false;
        return;
    }
    
    articulos[idx].buenos = (articulos[idx].buenos || 0) + 1;
    articulos[idx].nombresBuenos = articulos[idx].nombresBuenos || [];
    articulos[idx].nombresBuenos.push(nombre);
    
    // Actualizar estado actual
    estado.articuloActual = articulos[idx];
    
    // GUARDAR SOLO LOS "BUENOS" EN LOCALSTORAGE
    guardarBuenoEnLocalStorage(estado.articuloActual);
    
    // Mostrar mensaje de confirmación en la página
    mensajeConfirmacion.style.display = 'block';
    setTimeout(function() {
        mensajeConfirmacion.style.display = 'none';
    }, 3000);
    
    // Close modal immediately so user can browse (don't wait for backend)
    actualizarContadorBueno(estado.articuloActual);
    cerrarModalBueno();

    // Re-enable the button for next use
    botonConfirmarBueno.disabled = false;
    
    // Process sync in the background (don't await, let it happen asynchronously)
    sincronizarBuenoEnBackground(estado.articuloActual, nombre, idx);
}

// Process the remote sync in background without blocking UI
async function sincronizarBuenoEnBackground(articulo, nombre, idx) {
    // Track that a sync is starting
    activeSyncCount++;
    
    try {
        // Send both name and count to the Edge Function which will store the name privately
        // and update the public counter atomically. If configured, call it; otherwise fall back
        // to previous behavior (public table + private endpoint).
        if (remoteConfig && remoteConfig.privateEndpoint) {
            try {
                const resp = await fetch(remoteConfig.privateEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ article_id: articulo.id, nombre })
                });
                const json = await resp.json();
                if (resp.ok && json.updatedCount != null) {
                    // Use the authoritative updated count returned by the function
                    articulos[idx].buenos = json.updatedCount;
                    estado.articuloActual = articulos[idx];
                    guardarBuenoEnLocalStorage(estado.articuloActual);
                    // If user is still viewing this article, update the display
                    if (estado.articuloActual.id === articulo.id) {
                        actualizarContadorBueno(estado.articuloActual);
                    }
                } else if (resp.ok && json.inserted && json.inserted.length > 0 && json.updatedCount != null) {
                    articulos[idx].buenos = json.updatedCount;
                    estado.articuloActual = articulos[idx];
                    guardarBuenoEnLocalStorage(estado.articuloActual);
                    if (estado.articuloActual.id === articulo.id) {
                        actualizarContadorBueno(estado.articuloActual);
                    }
                } else {
                    // If function didn't return updatedCount, keep optimistic local count
                    console.warn('Private endpoint returned unexpected payload', json);
                }
            } catch (e) {
                console.warn('Error calling private endpoint (will retry):', e);
                // Queue for retry: store the sync job for later retries
                queueSyncRetry(articulo, nombre, idx);
            }
        } else {
            // Fallback: legacy behavior
            try {
                await guardarBuenoRemoto(articulo);
            } catch (e) {
                console.warn('Error guardando contador remoto (will retry):', e);
                queueSyncRetry(articulo, nombre, idx);
            }

            try {
                await enviarNombrePrivado(articulo, nombre);
            } catch (e) {
                console.warn('Error enviando nombre al endpoint privado (will retry):', e);
            }
        }
    } finally {
        // Sync is complete (or failed and queued for retry)
        activeSyncCount--;
    }
}

// Queue a failed sync job for retry (max 5 attempts, 5 second intervals)
function queueSyncRetry(articulo, nombre, idx, attempt = 1) {
    if (attempt > 5) {
        console.warn(`Sync failed after 5 attempts for article ${articulo.id}. Data saved locally.`);
        return;
    }
    
    // Schedule retry in 5 seconds
    setTimeout(() => {
        console.log(`Retrying sync for article ${articulo.id} (attempt ${attempt})`);
        sincronizarBuenoEnBackground(articulo, nombre, idx)
            .catch(() => {
                // If retry fails, queue the next attempt
                queueSyncRetry(articulo, nombre, idx, attempt + 1);
            });
    }, 5000);
}

function actualizarContadorBueno(articulo) {
    const contador = document.getElementById('contador-bueno');
    const n = articulo.buenos || 0;
    contador.textContent = `${n} persona${n === 1 ? '' : 's'} afirman que este texto está bueno`;
}

// Precargar imágenes para mejor experiencia
function precargarImagenes() {
    const imagenes = [];
    
    articulos.forEach(articulo => {
        if (articulo.imagen) {
            imagenes.push(articulo.imagen);
        }
    });
    
    // Precargar hasta 3 imágenes a la vez para no sobrecargar
    const precargarLote = (lote) => {
        lote.forEach(src => {
            const img = new Image();
            img.src = src;
        });
    };
    
    // Dividir en lotes de 3
    for (let i = 0; i < imagenes.length; i += 3) {
        setTimeout(() => {
            precargarLote(imagenes.slice(i, i + 3));
        }, i * 100); // Espaciar la precarga
    }
}

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function() {
    // Actualizar contador de visitas
    actualizarContadorVisitas();
    
    // Cargar artículos desde JSON
    cargarArticulos();
});