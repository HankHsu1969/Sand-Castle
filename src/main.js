import './style.css';
import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'));
game.boot();
window.__game = game; // handy for debugging from the console
