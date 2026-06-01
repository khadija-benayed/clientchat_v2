/**
 * src/main.jsx — Point d'entrée de l'application React
 *
 * Équivalent Java : la méthode main() ou la classe Application de Spring Boot.
 * Ce fichier est le premier exécuté. Il monte le composant racine <App>
 * dans le div#root du index.html.
 *
 * React.StrictMode active des vérifications supplémentaires en développement
 * (double rendu des composants pour détecter les effets de bord non idempotents).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // Variables CSS + Tailwind + styles globaux

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
