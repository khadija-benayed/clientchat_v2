exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { system, message, action } = JSON.parse(event.body);

    if (action === 'read_drive') {
      const url = message;
      const results = [];

      // Stratégie 1 : Google Sheet export CSV direct
      const sheetMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (sheetMatch) {
        const id = sheetMatch[1];
        // Essayer plusieurs formats d'export
        const urls = [
          `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&id=${id}`,
          `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`,
          `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv`,
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (r.ok) {
              const text = await r.text();
              if (text.length > 50 && !text.includes('<!DOCTYPE') && !text.includes('<html')) {
                return { statusCode: 200, headers, body: JSON.stringify({ text: text.substring(0, 5000), type: 'csv' }) };
              }
            }
          } catch(e) {}
        }
        return { statusCode: 200, headers, body: JSON.stringify({ text: '', error: 'Impossible de lire ce Sheet. Va dans Fichier → Partager → Publier sur le web → CSV, et colle ce lien.' }) };
      }

      // Stratégie 2 : Google Doc export texte
      const docMatch = url.match(/document\/d\/([a-zA-Z0-9_-]+)/);
      if (docMatch) {
        const id = docMatch[1];
        try {
          const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, { redirect: 'follow' });
          if (r.ok) {
            const text = await r.text();
            if (!text.includes('<!DOCTYPE')) {
              return { statusCode: 200, headers, body: JSON.stringify({ text: text.substring(0, 5000), type: 'txt' }) };
            }
          }
        } catch(e) {}
        return { statusCode: 200, headers, body: JSON.stringify({ text: '', error: 'Impossible de lire ce Doc. Vérifie que le partage est "Tout le monde avec le lien".' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ text: '', error: 'Lien non reconnu. Supporte les Google Sheets et Google Docs.' }) };
    }

    // Appel Claude normal
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: message }]
      })
    });
    const data = await r.json();
    if (data.error) return { statusCode: 400, headers, body: JSON.stringify({ error: data.error.message }) };
    const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '';
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
