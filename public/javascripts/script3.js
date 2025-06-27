let c = document.getElementById('c');
let ctx = c.getContext('2d');

c.height = window.innerHeight;
c.width = window.innerWidth;

let matrix = "qwertyuiopasdfghjklzxcvbnm!@#$%^&*()12345567890";
matrix = matrix.split("");

let font_size = 20;
let colums = c.width / font_size;
let drops = [];

for (var x = 0; x < colums; x++) {
    drops[x] = 50;
}

function draw(){
    ctx.fillStyle = "rgba(2, 17, 43, 0.1)";
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = "#3b82f6";
    ctx.font = font_size + "px arial";

    for (let i = 0; i <drops.length; i++) {
        let text = matrix[Math.floor(Math.random() * matrix.length)];

        ctx.fillText(text, i * font_size, drops[i] * font_size);
        if (drops[i] * font_size > c.height && Math.random() > 0.975) {
            drops[i] = 0;
        }
        drops[i]++;
    }
}

setInterval(draw, 50);


const form = document.getElementById('form');
const alertBox = document.getElementById('custom-alert');

form.addEventListener('submit', (e)=>{
    const pin = document.querySelector('input[name=pin').value;
    const cpin = document.querySelector('input[name=cpin').value;

    if (pin != cpin) {
        e.preventDefault();
        alertBox.classList.remove('hidden');

        setTimeout(()=>{
            alertBox.classList.add('hidden');
        }, 3000);
    }
});

const pass = document.getElementById('pin');
const cpass = document.getElementById('cpin');
const chk = document.getElementById('chk');

chk.onchange = (e) =>{
    pass.type = chk.checked ? "text" : "password";
    cpass.type = chk.checked ? "text" : "password";
};