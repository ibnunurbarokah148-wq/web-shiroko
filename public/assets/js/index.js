// Initialize AOS
AOS.init({
    duration: 800,
    once: true,
    offset: 100
});

// Particles.js Config (Sunaookami Shiroko Theme)
if (document.getElementById('particles-js')) {
    particlesJS('particles-js', {
        "particles": {
            "number": {
                "value": 60,
                "density": {
                    "enable": true,
                    "value_area": 800
                }
            },
            "color": {
                "value": ["#00b0f0", "#ffffff", "#1e90ff"]
            },
            "shape": {
                "type": "circle",
                "stroke": {
                    "width": 0,
                    "color": "#000000"
                }
            },
            "opacity": {
                "value": 0.5,
                "random": true,
                "anim": {
                    "enable": true,
                    "speed": 1,
                    "opacity_min": 0.1,
                    "sync": false
                }
            },
            "size": {
                "value": 3,
                "random": true,
                "anim": {
                    "enable": true,
                    "speed": 2,
                    "size_min": 0.1,
                    "sync": false
                }
            },
            "line_linked": {
                "enable": true,
                "distance": 150,
                "color": "#00b0f0",
                "opacity": 0.2,
                "width": 1
            },
            "move": {
                "enable": true,
                "speed": 1.5,
                "direction": "top",
                "random": true,
                "straight": false,
                "out_mode": "out",
                "bounce": false,
                "attract": {
                    "enable": false,
                    "rotateX": 600,
                    "rotateY": 1200
                }
            }
        },
        "interactivity": {
            "detect_on": "canvas",
            "events": {
                "onhover": {
                    "enable": true,
                    "mode": "grab"
                },
                "onclick": {
                    "enable": true,
                    "mode": "push"
                },
                "resize": true
            },
            "modes": {
                "grab": {
                    "distance": 140,
                    "line_linked": {
                        "opacity": 0.5
                    }
                },
                "push": {
                    "particles_nb": 3
                }
            }
        },
        "retina_detect": true
    });
}

// GSAP Animations (Hanya jalan sekali saat pertama buka web)
if (!sessionStorage.getItem('hasSeenIntro')) {
    gsap.from('.logo', { opacity: 0, y: -20, duration: 1, delay: 0.5 });
    gsap.from('.nav-links a', { opacity: 0, y: -20, duration: 0.5, stagger: 0.1, delay: 0.8 });
    sessionStorage.setItem('hasSeenIntro', 'true');
}

// Typing Effect for Status & Socket.IO
const typingText = document.getElementById('typing-text');
if (typingText) {
    const defaultStatuses = [
        "Menunggu perintah...",
        "✓ Minecraft sedang online",
        "✓ Discord aktif",
        "✓ WhatsApp aktif",
        "✓ Ollama Connected",
        "✓ Gemini Connected"
    ];
    let idx = 0;
    let isBotTyping = false;
    let currentTypingUser = '';

    // Rotasi status default
    let statusInterval = setInterval(() => {
        if (isBotTyping) return; // Pause rotasi jika sedang ngetik
        
        gsap.to(typingText, {
            opacity: 0, duration: 0.5, onComplete: () => {
                if (isBotTyping) return;
                idx = (idx + 1) % defaultStatuses.length;
                typingText.textContent = defaultStatuses[idx];
                gsap.to(typingText, { opacity: 1, duration: 0.5 });
            }
        });
    }, 4000);

    // Koneksi Socket.IO ke VPS
    if (typeof io !== 'undefined' && window.VPS_API_URL) {
        const socket = io(window.VPS_API_URL);
        
        socket.on('connect', () => {
            console.log('Terhubung ke WebSocket Server Shiroko.');
        });

        socket.on('bot_status', (data) => {
            if (data.isTyping) {
                isBotTyping = true;
                currentTypingUser = data.user || 'Seseorang';
                
                // Animasi langsung ubah teks
                gsap.to(typingText, {
                    opacity: 0, duration: 0.2, onComplete: () => {
                        typingText.textContent = `Shiroko sedang merespon ${currentTypingUser}... 🐺✍️`;
                        gsap.to(typingText, { opacity: 1, duration: 0.2 });
                    }
                });
            } else {
                isBotTyping = false;
                gsap.to(typingText, {
                    opacity: 0, duration: 0.3, onComplete: () => {
                        typingText.textContent = "Selesai merespon! ✓";
                        gsap.to(typingText, { opacity: 1, duration: 0.3 });
                        
                        // Kembali ke rotasi normal setelah 3 detik
                        setTimeout(() => {
                            if (!isBotTyping) {
                                gsap.to(typingText, {
                                    opacity: 0, duration: 0.5, onComplete: () => {
                                        typingText.textContent = defaultStatuses[idx];
                                        gsap.to(typingText, { opacity: 1, duration: 0.5 });
                                    }
                                });
                            }
                        }, 3000);
                    }
                });
            }
        });
    }
}

// Counter Animation for Stats
const counters = document.querySelectorAll('.counter');
counters.forEach(counter => {
    const target = +counter.innerText;
    counter.innerText = '0';
    
    gsap.to(counter, {
        innerText: target,
        duration: 2,
        snap: { innerText: 1 },
        ease: "power2.out",
        scrollTrigger: {
            trigger: counter,
            start: "top 80%"
        }
    });
});
