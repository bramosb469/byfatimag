document.addEventListener('DOMContentLoaded', () => {
  
  // Sidebar toggle on mobile
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('show');
    });
  }

  // Delete confirmations
  const deleteForms = document.querySelectorAll('.form-delete');
  deleteForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!confirm('¿Estás seguro de que deseas eliminar este elemento? Esta acción no se puede deshacer.')) {
        e.preventDefault();
      }
    });
  });

  // Auto-dismiss alerts
  const alerts = document.querySelectorAll('.alert:not(.alert-permanent)');
  alerts.forEach(alert => {
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    }, 5000);
  });

  // Color Pickers sync
  const setupColorSync = (inputId, textId) => {
    const colorInput = document.getElementById(inputId);
    const textInput = document.getElementById(textId);
    if (!colorInput || !textInput) return;

    colorInput.addEventListener('input', (e) => {
      textInput.value = e.target.value;
      updatePreview();
    });

    textInput.addEventListener('input', (e) => {
      let val = e.target.value;
      if (val.match(/^#[0-9a-f]{6}$/i)) {
        colorInput.value = val;
        updatePreview();
      }
    });
  };

  const updatePreview = () => {
    const preview = document.getElementById('colorPreview');
    if (!preview) return;

    const bg = document.getElementById('colorBgInput')?.value;
    const primary = document.getElementById('colorPrimaryInput')?.value;
    const accent = document.getElementById('colorAccentInput')?.value;

    if (bg) preview.style.backgroundColor = bg;
    
    const h5 = preview.querySelector('h5');
    if (h5 && primary) h5.style.color = primary;
    
    const btn = preview.querySelector('button');
    if (btn && accent) {
      btn.style.backgroundColor = accent;
    }
  };

  setupColorSync('colorPrimaryInput', 'colorPrimaryText');
  setupColorSync('colorAccentInput', 'colorAccentText');
  setupColorSync('colorBgInput', 'colorBgText');

});
