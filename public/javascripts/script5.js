setTimeout(() => {
      const msg = document.getElementById('flashMsg');
      if (msg) {
        msg.style.opacity = '0';
        setTimeout(() => {
          msg.remove();
        }, 500); // wait for fade-out animation
      }
    }, 3000);