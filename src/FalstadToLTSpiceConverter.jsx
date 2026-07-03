import { useState } from 'react';
import { convertFalstadToAsc } from './utils/functions.js';
import { generatePlugin } from './utils/circuitToVST3.js';

function FalstadToLTSpiceConverter() {
  const [xmlContent, setXmlContent] = useState('');
  const [ascContent, setAscContent] = useState('');
  const [vst3Result, setVst3Result] = useState(null);
  const [pluginName, setPluginName] = useState('CircuitPlugin');

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const xml = e.target.result;
      setXmlContent(xml);
      const asc = convertFalstadToAsc(xml);
      setAscContent(asc);
      setVst3Result(null);
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

  const handleGenerateVST3 = () => {
    try {
      const result = generatePlugin(xmlContent, pluginName);
      setVst3Result(result);
    } catch (err) {
      alert('Error generating VST3: ' + err.message);
    }
  };

  const downloadSource = (filename, content) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllSources = () => {
    if (!vst3Result) return;
    Object.entries(vst3Result.sources).forEach(([name, content]) => {
      downloadSource(name, content);
    });
  };

  const topologyLabel = (topology) => {
    if (topology.type === 'rc_lowpass') {
      const { rValue, cValue, cutoffHz, refs } = topology.params;
      return `RC Low-Pass (${refs.r}=${rValue.toPrecision(4)}Ω, ${refs.c}=${cValue.toPrecision(4)}F, fc=${cutoffHz.toPrecision(4)}Hz)`;
    }
    return `Topology: ${topology.type}${topology.reason ? ' (' + topology.reason + ')' : ''}`;
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

          <hr style={{ margin: '2rem 0' }} />
          <h3>Gerar VST3</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <label style={{ fontWeight: 'bold' }}>Nome do Plugin:</label>
            <input
              type="text"
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              placeholder="Nome do plugin"
              style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', flex: 1 }}
            />
            <button onClick={handleGenerateVST3}>Generate VST3 Plugin</button>
          </div>

          {vst3Result && (
            <div>
              <h4>Topology Detected: {vst3Result.topology.type === 'rc_lowpass' ? '✓ RC Low-Pass Filter' : vst3Result.topology.type === 'diode_clipper' ? '✓ Diode Clipper' : vst3Result.topology.type === 'mini_fuzz' ? '✓ Mini Fuzz' : '✗ ' + vst3Result.topology.type}</h4>
              <p style={{ fontSize: '0.9rem', color: '#666' }}>{topologyLabel(vst3Result.topology)}</p>

              {vst3Result.topology.type !== 'unknown' && (
                <>
                  <h4>Generated Source Files:</h4>
                  {Object.entries(vst3Result.sources).map(([name, content]) => (
                    <div key={name}>
                      <h5>{name}</h5>
                      <pre style={{ background: '#f4f4f4', padding: '0.5rem', maxHeight: '200px', overflow: 'auto', fontSize: '0.8rem' }}>
                        {content}
                      </pre>
                      <button onClick={() => downloadSource(name, content)}>Download {name}</button>
                    </div>
                  ))}
                  <div style={{ marginTop: '1rem' }}>
                    <button onClick={downloadAllSources} style={{ fontWeight: 'bold' }}>
                      Download All Sources
                    </button>
                  </div>
                  <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff3cd', borderRadius: '4px' }}>
                    <strong>Para compilar o VST3:</strong>
                    <ol>
                      <li>Abra o <strong>Developer Command Prompt for VS</strong> (ou x64 Native Tools)</li>
                      <li>Navegue até a pasta com os arquivos: <code>cd caminho/para/pasta</code></li>
                      <li>Configure: <code>cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release</code></li>
                      <li>Compile: <code>cmake --build build --config Release</code></li>
                      <li>O .vst3 estará em <code>build/SEU-NOME_artefacts/Release/VST3/</code></li>
                      <li>Copie para <code>C:\Program Files\Common Files\VST3\</code></li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FalstadToLTSpiceConverter;