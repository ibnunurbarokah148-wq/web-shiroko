// Public-site enhancements are intentionally defensive: pages without optional
// libraries still render and retain their core interactions.
(function () {
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    if (hamburger && navLinks) {
        hamburger.addEventListener('click', function () {
            const isOpen = navLinks.classList.toggle('active');
            hamburger.setAttribute('aria-expanded', String(isOpen));
        });
    }

    if (window.USE_AOS && typeof window.AOS !== 'undefined' && typeof window.AOS.init === 'function') {
        window.AOS.init({ duration: 800, once: true, offset: 100 });
    }

    const particlesContainer = document.getElementById('particles-js');
    if (particlesContainer) {
        const loadParticles = function () {
            if (typeof window.particlesJS === 'function') {
                initParticles();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js';
            script.async = true;
            script.onload = initParticles;
            script.onerror = function () {
                // The canvas is decorative; the page remains fully usable without it.
                particlesContainer.remove();
            };
            document.head.appendChild(script);
        };
        const schedule = window.requestIdleCallback || function (callback) {
            window.setTimeout(callback, 1200);
        };
        schedule(loadParticles, { timeout: 2000 });
    }

    function initParticles() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        window.particlesJS('particles-js', {
            particles: {
                number: {
                    value: isMobile ? 18 : 42,
                    density: { enable: true, value_area: isMobile ? 1000 : 900 }
                },
                color: { value: ['#00b0f0', '#ffffff', '#1e90ff'] },
                shape: { type: 'circle', stroke: { width: 0, color: '#000000' } },
                opacity: {
                    value: isMobile ? 0.35 : 0.5,
                    random: true,
                    anim: { enable: !isMobile, speed: 1, opacity_min: 0.1, sync: false }
                },
                size: {
                    value: isMobile ? 2 : 3,
                    random: true,
                    anim: { enable: !isMobile, speed: 2, size_min: 0.1, sync: false }
                },
                line_linked: {
                    enable: true,
                    distance: isMobile ? 120 : 150,
                    color: '#00b0f0',
                    opacity: isMobile ? 0.12 : 0.2,
                    width: 1
                },
                move: {
                    enable: true,
                    speed: isMobile ? 0.7 : 1.5,
                    direction: 'top',
                    random: true,
                    straight: false,
                    out_mode: 'out',
                    bounce: false,
                    attract: { enable: false, rotateX: 600, rotateY: 1200 }
                }
            },
            interactivity: {
                detect_on: 'canvas',
                events: {
                    onhover: { enable: !isMobile, mode: 'grab' },
                    onclick: { enable: !isMobile, mode: 'push' },
                    resize: true
                },
                modes: {
                    grab: { distance: 140, line_linked: { opacity: 0.5 } },
                    push: { particles_nb: 2 }
                }
            },
            retina_detect: !isMobile
        });
    }

    const typingText = document.getElementById('typing-text');
    if (typingText) {
        const defaultStatuses = [
            'Menunggu perintah...',
            '✓ Minecraft sedang online',
            '✓ Discord aktif',
            '✓ WhatsApp aktif',
            '✓ Ollama Connected',
            '✓ Gemini Connected'
        ];
        let idx = 0;
        let isBotTyping = false;
        let socketStarted = false;
        let statusTimeout;

        const setStatus = function (text, animate) {
            if (!animate || !window.gsap) {
                typingText.textContent = text;
                typingText.style.opacity = '1';
                return;
            }
            window.gsap.to(typingText, {
                opacity: 0,
                duration: 0.15,
                onComplete: function () {
                    typingText.textContent = text;
                    window.gsap.to(typingText, { opacity: 1, duration: 0.15 });
                }
            });
        };

        const rotateStatus = function () {
            if (!isBotTyping && !document.hidden) {
                idx = (idx + 1) % defaultStatuses.length;
                setStatus(defaultStatuses[idx], true);
            }
            statusTimeout = window.setTimeout(rotateStatus, 4000);
        };

        // Leave the server-rendered fallback visible for the first paint.
        window.setTimeout(function () {
            rotateStatus();
        }, 1500);

        const startSocket = function () {
            if (socketStarted || typeof window.io !== 'function' || !window.VPS_API_URL) return;
            socketStarted = true;
            const socket = window.io(window.VPS_API_URL, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                timeout: 5000
            });

            socket.on('bot_status', function (data) {
                if (!data) return;
                if (data.isTyping) {
                    isBotTyping = true;
                    setStatus('Shiroko sedang merespon ' + (data.user || 'Seseorang') + '...', true);
                } else {
                    isBotTyping = false;
                    setStatus('Selesai merespon!', true);
                }
            });
        };

        // Socket.IO is non-critical and starts after the hero has had a chance to paint.
        window.setTimeout(startSocket, 1000);
        window.addEventListener('beforeunload', function () {
            window.clearTimeout(statusTimeout);
        }, { once: true });
    }

    const counters = document.querySelectorAll('.counter');
    if (counters.length && window.gsap) {
        counters.forEach(function (counter) {
            const target = Number(counter.textContent) || 0;
            counter.textContent = '0';
            window.gsap.to(counter, {
                innerText: target,
                duration: 2,
                snap: { innerText: 1 },
                ease: 'power2.out'
            });
        });
    }
}());
