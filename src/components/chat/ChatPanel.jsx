/**
 * src/components/chat/ChatPanel.jsx — Panneau de chat complet
 *
 * Assemble MessageList + ChatInput et orchestre les interactions :
 * - Envoi de messages via useChat
 * - Ouverture de la modal KB
 * - Prompts rapides depuis l'écran de bienvenue
 * - Sauvegarde de session
 *
 * Props :
 * @param {object}   client        - Client courant
 * @param {Array}    tasks         - Tâches (pour le contexte IA)
 * @param {Array}    summaries     - Résumés de sessions
 * @param {Array}    docCache      - Cache docs Drive
 * @param {string}   jwtToken      - JWT Supabase
 * @param {Function} onTasksUpdate - Callback quand l'IA modifie des tâches
 * @param {Function} onSessionSave - Callback après sauvegarde session
 * @param {Function} onOpenKbModal - Ouvre la modal "Sauvegarder dans KB"
 * @param {Function} onSetSyncStatus  - Met à jour le statut de sync dans la topbar
 * @param {object}   pendingChatMsg   - Message à injecter depuis une sync externe
 * @param {Function} onPendingChatMsgConsumed - Appelée après injection
 */
import { useEffect, useCallback } from 'react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { useChat } from '../../hooks/useChat';

export default function ChatPanel({
  client, tasks, summaries, docCache, jwtToken, currentUserId,
  onTasksUpdate, onSessionSave, onOpenKbModal, onSetSyncStatus,
  pendingChatMsg, onPendingChatMsgConsumed,
}) {
  const { messages, isLoading, isSending, sendMessage, sendWebSearch, addMessage, clearMessages, triggerSessionSave } =
    useChat({ client, tasks, summaries, docCache, jwtToken, currentUserId, onTasksUpdate, onSessionSave });

  // Vider le chat quand le client change
  useEffect(() => {
    clearMessages();
  }, [client?.id]); // eslint-disable-line

  // Injecter les messages issus des syncs Drive/Email
  useEffect(() => {
    if (!pendingChatMsg) return;
    addMessage('a', pendingChatMsg.message);
    onPendingChatMsgConsumed?.();
  }, [pendingChatMsg]); // eslint-disable-line

  // Mettre à jour le statut de sync pendant les appels backend
  useEffect(() => {
    if (isSending) onSetSyncStatus?.({ color: '#EF9F27', label: 'envoi…' });
    else onSetSyncStatus?.({ color: '#52b788', label: 'synchronisé' });
  }, [isSending]); // eslint-disable-line

  const handleSend = useCallback(async (text, file) => {
    await sendMessage(text, file);
  }, [sendMessage]);

  const handlePromptClick = useCallback((text) => {
    sendMessage(text, null);
  }, [sendMessage]);

  const handleSaveToKb = useCallback((text) => {
    onOpenKbModal?.(text);
  }, [onOpenKbModal]);

  // Sauvegarde de session à la fermeture/changement de client
  useEffect(() => {
    return () => { triggerSessionSave(); };
  }, [client?.id]); // eslint-disable-line

  return (
    <div className="chat-panel">
      <MessageList
        messages={messages}
        isLoading={isLoading}
        clientName={client?.name}
        client={client}
        onSaveToKb={handleSaveToKb}
        onPromptClick={handlePromptClick}
        onWebSearch={sendWebSearch}
      />
      <ChatInput
        onSend={handleSend}
        disabled={isLoading || isSending}
      />
    </div>
  );
}
