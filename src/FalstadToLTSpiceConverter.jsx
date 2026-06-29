import { useState } from 'react';
import { convertFalstadToAsc } from './utils/functions.js';

function FalstadToLTSpiceConverter() {
  const [ascContent, setAscContent] = useState('');

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const xml = e.target.result;
      const asc = convertFalstadToAsc(xml);
      setAscContent(asc);
    };
    reader.readAsText(file);
  };

  const downloadAsc = () => {
    const blob = new Blob([ascContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuito.asc';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2>Conversor Falstad → LTspice (Schematic)</h2>
      <input type="file" accept=".txt" onChange={handleFileUpload} />
      {ascContent && (
        <>
          <h3>Arquivo .asc gerado:</h3>
          <pre style={{ background: '#f4f4f4', padding: '1rem', maxHeight: '300px', overflow: 'auto' }}>
            {ascContent}
          </pre>
          <button onClick={downloadAsc}>Baixar .asc</button>
        </>
      )}
    </div>
  );
}

export default FalstadToLTSpiceConverter;