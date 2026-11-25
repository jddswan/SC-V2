// Point d'entrée navigateur : monte le jeu dans <div id="root">.
import React from 'react';
import { createRoot } from 'react-dom/client';
import Game from './SupplyChainTycoon.jsx';

createRoot(document.getElementById('root')).render(React.createElement(Game));
