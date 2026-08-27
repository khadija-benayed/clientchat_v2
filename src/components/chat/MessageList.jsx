/**
 * src/components/chat/MessageList.jsx — Liste scrollable des messages
 *
 * Affiche tous les messages du chat + l'indicateur "thinking" quand
 * l'IA est en train de répondre.
 *
 * Auto-scroll vers le bas à chaque nouveau message.
 * Affiche l'écran de bienvenue quand la liste est vide.
 *
 * Props :
 * @param {Array}    messages     - Tableau de messages
 * @param {boolean}  isLoading    - true = afficher le "thinking..."
 * @param {string}   clientName   - Nom du client
 * @param {object}   client       - Client courant (pour l'écran bienvenue)
 * @param {Function} onSaveToKb   - Pour passer aux bulles
 * @param {Function} onPromptClick - Clic sur un prompt rapide de bienvenue
 */
import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

export default function MessageList({ messages, isLoading, clientName, client, onSaveToKb, onPromptClick, onWebSearch }) {
  const bottomRef = useRef(null);

  // Scroll automatique vers le bas à chaque nouveau message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const showWelcome = messages.length === 0 && !isLoading;

  return (
    <div className="msgs" id="msgs">
      {showWelcome ? (
        <WelcomeState client={client} onPromptClick={onPromptClick} />
      ) : (
        <>
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              clientName={clientName}
              onSaveToKb={onSaveToKb}
              onWebSearch={onWebSearch}
            />
          ))}
          {isLoading && <ThinkingIndicator clientName={clientName} />}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

/**
 * Étapes annoncées pendant l'attente du premier token, avec leur seuil (ms).
 *
 * Avant que le moindre mot puisse s'afficher, le backend enchaîne HyDE (un appel
 * Gemini complet), l'embedding, la recherche hybride puis le reranking — soit 3 à
 * 6 s mesurées en production. Les seuils ci-dessous ne pilotent rien : ils décrivent
 * ce que le backend est déjà en train de faire à cet instant, pour que l'attente ne
 * soit pas un écran muet. Le passage au vrai texte, lui, reste piloté par l'arrivée
 * du premier token, pas par un minuteur.
 */
const THINKING_STEPS = [
  { after: 1200, label: 'Recherche dans les documents…' },
  { after: 4000, label: 'Analyse des extraits pertinents…' },
  { after: 8000, label: 'Rédaction de la réponse…' },
];

/** Indicateur "..." pendant la réponse IA */
function ThinkingIndicator({ clientName }) {
  const [label, setLabel] = useState(null);

  useEffect(() => {
    const timers = THINKING_STEPS.map(step =>
      setTimeout(() => setLabel(step.label), step.after)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="msg a">
      <div className="msg-who">Claude · {clientName || ''}</div>
      <div className="thinking">
        <div className="dp" /><div className="dp" /><div className="dp" />
        {label && <span className="thinking-label">{label}</span>}
      </div>
    </div>
  );
}

/** Écran de bienvenue avec prompts rapides */
function WelcomeState({ client, onPromptClick }) {
  const prompts = [
    { icon: '📋', cls: 'orange', text: "Fais-moi un point sur l'avancement du projet" },
    { icon: '🎯', cls: 'navy',   text: 'Quelles sont les tâches prioritaires en ce moment ?' },
    { icon: '📁', cls: 'coral',  text: 'Résume les derniers documents partagés par le client' },
    { icon: '💡', cls: 'blue',   text: 'Quels sont les prochains jalons importants ?' },
  ];

  const h = new Date().getHours();
  const greeting = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

  let members = [];
  try { members = JSON.parse(client?.members || '[]'); } catch {}
  const mStr = members.map(m => m.name || m.initials).join(' & ');

  return (
    <div className="welcome-state" id="welcome-state">
      <div className="ws-hex-cluster">
        <div className="ws-hex ws-hex-tr" />
        <div className="ws-hex ws-hex-bl" />
        <div className="ws-hex ws-hex-r" />
        <div className="ws-hex ws-hex-c" />
      </div>
      <div className="ws-greeting">{greeting}</div>
      <div className="ws-client-name">{client?.name || ''}</div>
      <div className="ws-sub">
        {mStr ? `Équipe · ${mStr} — prêts à butiner ?` : 'Prêt à butiner ?'}
      </div>
      <div className="ws-prompts">
        {prompts.map((p, i) => (
          <button
            key={i}
            className="ws-prompt-chip"
            onClick={() => onPromptClick(p.text)}
          >
            <span className={`ws-prompt-icon ${p.cls}`}>{p.icon}</span>
            <span className="ws-prompt-text">{p.text}</span>
            <span className="ws-prompt-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
