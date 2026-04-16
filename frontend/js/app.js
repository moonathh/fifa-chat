// Datos de prueba para el Avance 1
const mockData = {
    tasks: [
        { title: "Recoger Fan ID", desc: "Ir al módulo del Estadio BBVA", priority: "Alta", owner: "Juan Pérez", status: false },
        { title: "Reserva de Hotel", desc: "Confirmar check-in para el grupo", priority: "Media", owner: "Tú", status: true },
        { title: "Comprar snacks", desc: "Para el camino al partido", priority: "Baja", owner: "María García", status: false }
    ],
    points: 1250,
    rank: "Turista Oro 🏆",
    progress: 75
};

// Función para cargar tareas en task.html
function loadTasks() {
    const container = document.getElementById('tasks-dynamic-list');
    const template = document.getElementById('task-template');
    
    if (container && template) {
        container.innerHTML = ''; // Limpiar
        mockData.tasks.forEach(task => {
            const clone = template.content.cloneNode(true);
            clone.querySelector('.task-title').textContent = task.title;
            clone.querySelector('.task-desc').textContent = task.desc;
            clone.querySelector('.task-priority').textContent = task.priority;
            clone.querySelector('.task-owner').textContent = "Asignado a: " + task.owner;
            if(task.status) clone.querySelector('.task-checkbox').checked = true;
            container.appendChild(clone);
        });
    }
}

// Función para cargar recompensas en rewards.html
function loadRewards() {
    const pointsEl = document.getElementById('user-points');
    const rankEl = document.getElementById('user-rank');
    const progressEl = document.getElementById('progress-fill');
    
    if (pointsEl) pointsEl.textContent = mockData.points;
    if (rankEl) rankEl.textContent = "Nivel: " + mockData.rank;
    if (progressEl) progressEl.style.width = mockData.progress + "%";
}

// Ejecutar al cargar la página
window.onload = () => {
    loadTasks();
    loadRewards();
};