setTimeout(() => {
    const el = document.querySelector('.flash-message');
    if (el) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500);
    }
}, 3000);