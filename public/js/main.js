document.addEventListener('DOMContentLoaded', () => {

  // 1. Navbar scroll effect
  const navbar = document.getElementById('mainNav');
  if (navbar) {
    const checkScroll = () => {
      if (window.scrollY > 50) {
        navbar.classList.add('navbar-scrolled');
      } else {
        navbar.classList.remove('navbar-scrolled');
      }
    };
    window.addEventListener('scroll', checkScroll);
    checkScroll(); // Init
  }

  // 2. Scroll animations (Intersection Observer)
  const fadeElements = document.querySelectorAll('.fade-in-up');
  if (fadeElements.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    
    fadeElements.forEach(el => observer.observe(el));
  } else {
    fadeElements.forEach(el => el.classList.add('visible')); // Fallback
  }

  // 4. Gallery Filter
  const filterBtns = document.querySelectorAll('.gallery-filter-btn');
  const galleryItems = document.querySelectorAll('.gallery-item-masonry');
  
  if (filterBtns.length > 0) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Remove active class from all
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        const filter = e.target.getAttribute('data-filter');
        
        galleryItems.forEach(item => {
          if (filter === 'all' || item.getAttribute('data-servicio') === filter) {
            item.style.display = 'block';
            setTimeout(() => item.style.opacity = '1', 50);
          } else {
            item.style.opacity = '0';
            setTimeout(() => item.style.display = 'none', 300);
          }
        });
      });
    });
  }

  // 6. Booking Form Multi-step Logic
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    let currentStep = 1;
    const totalSteps = 4;
    
    const updateSteps = () => {
      // Containers
      document.querySelectorAll('.step-content').forEach((el, index) => {
        if (index + 1 === currentStep) {
          el.classList.remove('d-none');
          el.classList.add('active');
        } else {
          el.classList.add('d-none');
          el.classList.remove('active');
        }
      });
      
      // Indicators
      document.querySelectorAll('.step-item').forEach((el, index) => {
        if (index + 1 < currentStep) {
          el.classList.add('completed');
          el.classList.remove('active');
        } else if (index + 1 === currentStep) {
          el.classList.add('active');
          el.classList.remove('completed');
        } else {
          el.classList.remove('active', 'completed');
        }
      });
      
      // Progress bar
      const progress = ((currentStep - 1) / (totalSteps - 1)) * 100;
      document.getElementById('stepProgress').style.width = `${progress}%`;
    };

    // Navigation Buttons
    document.querySelectorAll('.btn-next').forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentStep < totalSteps) {
          currentStep++;
          updateSteps();
        }
      });
    });
    document.querySelectorAll('.btn-prev').forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentStep > 1) {
          currentStep--;
          updateSteps();
        }
      });
    });

    // Step 1: Select Service
    const serviceCards = document.querySelectorAll('.service-select-card');
    const inputServicioId = document.getElementById('servicio_id');
    const step1Next = document.querySelector('#step1 .btn-next');
    
    // Check if preselected
    if (inputServicioId && inputServicioId.value) {
      step1Next.removeAttribute('disabled');
      const selected = document.querySelector(`.service-select-card[data-id="${inputServicioId.value}"]`);
      if (selected) {
        document.getElementById('summaryService').textContent = selected.getAttribute('data-name');
        
        // Auto-advance to step 2
        setTimeout(() => {
          currentStep = 2;
          updateSteps();
        }, 100);
      }
    }

    serviceCards.forEach(card => {
      card.addEventListener('click', () => {
        serviceCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        inputServicioId.value = card.getAttribute('data-id');
        document.getElementById('summaryService').textContent = card.getAttribute('data-name');
        step1Next.removeAttribute('disabled');
        
        // Auto-advance
        setTimeout(() => {
          currentStep = 2;
          updateSteps();
        }, 200);
      });
    });

    // Step 2: Calendar Logic
    let currentDate = new Date();
    const inputFecha = document.getElementById('fecha_seleccionada');
    const step2Next = document.querySelector('#step2 .btn-next');
    const calDaysContainer = document.getElementById('calendarDays');
    const displaySelectedDate = document.getElementById('displaySelectedDate');
    const summaryDate = document.getElementById('summaryDate');
    
    const isSundayClosed = window.horarioDomingo === 'Cerrado';

    const renderCalendar = () => {
      if (!calDaysContainer) return;
      calDaysContainer.innerHTML = '';
      
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      
      const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      document.getElementById('currentMonthYear').textContent = `${monthNames[month]} ${year}`;
      
      const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      
      const today = new Date();
      today.setHours(0,0,0,0);
      
      // Empty cells
      for (let i = 0; i < firstDay; i++) {
        const div = document.createElement('div');
        div.className = 'empty';
        calDaysContainer.appendChild(div);
      }
      
      // Days
      for (let i = 1; i <= daysInMonth; i++) {
        const dateObj = new Date(year, month, i);
        const div = document.createElement('div');
        div.textContent = i;
        
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        const dayOfWeek = dateObj.getDay();
        
        if (dateObj < today || (isSundayClosed && dayOfWeek === 0)) {
          div.className = 'disabled';
        } else {
          div.className = 'selectable';
          if (inputFecha.value === dateStr) {
            div.classList.add('selected');
          }
          
          div.addEventListener('click', () => {
            document.querySelectorAll('.calendar-days .selectable').forEach(d => d.classList.remove('selected'));
            div.classList.add('selected');
            inputFecha.value = dateStr;
            
            const formattedDate = dateObj.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
            displaySelectedDate.textContent = formattedDate;
            summaryDate.textContent = formattedDate;
            
            step2Next.removeAttribute('disabled');
            
            // Reset step 3
            document.getElementById('hora_seleccionada').value = '';
            document.querySelector('#step3 .btn-next').setAttribute('disabled', 'true');
            document.getElementById('summaryTime').textContent = '-';
            
            fetchTimeSlots(dateStr);

            // Auto-advance
            setTimeout(() => {
              currentStep = 3;
              updateSteps();
            }, 200);
          });
        }
        calDaysContainer.appendChild(div);
      }
    };

    if (calDaysContainer) {
      renderCalendar();
      document.getElementById('prevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
      });
      document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
      });
    }

    // Step 3: Fetch Time Slots
    const fetchTimeSlots = async (dateStr) => {
      const container = document.getElementById('timeSlotsContainer');
      const spinner = document.getElementById('timeSpinner');
      const step3Next = document.querySelector('#step3 .btn-next');
      
      // Clear previous
      Array.from(container.children).forEach(child => {
        if (child.id !== 'timeSpinner') child.remove();
      });
      
      spinner.classList.remove('d-none');
      
      try {
        const res = await fetch(`/api/horarios-disponibles/${dateStr}`);
        const times = await res.json();
        
        spinner.classList.add('d-none');
        
        if (times.length === 0) {
          container.insertAdjacentHTML('beforeend', '<p class="text-muted w-100 text-center">No hay horarios disponibles para esta fecha.</p>');
          return;
        }
        
        times.forEach(time => {
          const div = document.createElement('div');
          div.className = 'time-slot font-heading';
          div.textContent = time;
          
          div.addEventListener('click', () => {
            document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('selected'));
            div.classList.add('selected');
            document.getElementById('hora_seleccionada').value = time;
            document.getElementById('summaryTime').textContent = time;
            step3Next.removeAttribute('disabled');
            
            // Auto-advance
            setTimeout(() => {
              currentStep = 4;
              updateSteps();
            }, 200);
          });
          
          container.appendChild(div);
        });
      } catch (error) {
        spinner.classList.add('d-none');
        container.insertAdjacentHTML('beforeend', '<p class="text-danger">Error al cargar horarios.</p>');
      }
    };
  }
});

// Lightbox
window.openLightbox = function(el) {
  const type = el.getAttribute('data-type');
  const url = el.getAttribute('data-url');
  const beforeUrl = el.getAttribute('data-before');
  const title = el.getAttribute('data-title');
  
  const contentContainer = document.getElementById('lightboxContent');
  const titleEl = document.getElementById('lightboxTitle');
  
  contentContainer.innerHTML = '';
  titleEl.textContent = title;
  
  if (beforeUrl) {
    contentContainer.innerHTML = `
      <div class="text-center text-white"><p class="mb-2">ANTES</p><img src="${beforeUrl}" class="img-fluid rounded" style="max-height: 70vh;"></div>
      <div class="text-center text-white"><p class="mb-2">DESPUÉS</p><img src="${url}" class="img-fluid rounded" style="max-height: 70vh;"></div>
    `;
  } else if (type === 'video') {
    contentContainer.innerHTML = `
      <video controls autoplay class="img-fluid rounded" style="max-height: 80vh;">
        <source src="${url}" type="video/mp4">
        Tu navegador no soporta video.
      </video>
    `;
  } else {
    contentContainer.innerHTML = `<img src="${url}" class="img-fluid rounded" style="max-height: 80vh;">`;
  }
  
  const modal = new bootstrap.Modal(document.getElementById('lightboxModal'));
  modal.show();
};

// Validacion Paso 4
const btnSubmitTurno = document.getElementById('btnSubmitTurno');
const requiredMsg = document.getElementById('requiredMsg');
const requiredFields = document.querySelectorAll('.required-field');

if (btnSubmitTurno && requiredFields.length > 0) {
  const checkFields = () => {
    let allFilled = true;
    requiredFields.forEach(field => {
      if (!field.value.trim()) {
        allFilled = false;
      }
    });
    
    if (allFilled) {
      btnSubmitTurno.removeAttribute('disabled');
      requiredMsg.style.display = 'none';
    } else {
      btnSubmitTurno.setAttribute('disabled', 'disabled');
      requiredMsg.style.display = 'block';
    }
  };

  requiredFields.forEach(field => {
    field.addEventListener('input', checkFields);
  });
  
  checkFields(); // Run on init
}

