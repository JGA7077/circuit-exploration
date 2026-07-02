# Planejamento de Software: Conversor de Circuitos (Falstad/LTspice) para VST3

## 1. Viabilidade Tecnológica de Linguagens

* **Python:** É excelente para criar protótipos e ferramentas de automação/scripts (como o interpretador de circuitos). Contudo, criar plugins VST3 nativos rodando diretamente em Python gera problemas de latência em tempo real e engasgos no áudio devido ao gerenciamento automático de memória (*Garbage Collector*).
* **JavaScript / React:** Excelente escolha para manter o front-end e a lógica do software conversor. O ecossistema Node.js pode ler os arquivos de circuitos, processar a matemática e automatizar a geração do código do plugin.
* **C++ (JUCE):** O padrão absoluto da indústria de áudio. Garante latência zero e uso de CPU extremamente baixo na DAW, pois executa apenas equações matemáticas compiladas nativamente.

## 2. Configuração do Ambiente Local Recomendado

Para um fluxo moderno, ágil e que economiza espaço em disco no Windows (cerca de **4 GB a 6 GB** no total, em vez dos 15 GB do Visual Studio tradicional):

* **IDE:** Visual Studio Code (VS Code) + Extensões de C++ e CMake Tools (~1 GB).
* **Compilador:** Build Tools para Visual Studio (apenas as ferramentas de compilação MSVC via linha de comando, sem a interface gráfica) (~3 a 4 GB).
* **Automação:** CMake (~100 MB).
* **Framework de Áudio:** JUCE local (~150 MB).

## 3. Arquitetura do Software Conversor

Para obter a máxima performance na DAW, o processamento pesado de engenharia elétrica deve ocorrer **no momento da conversão (no software em JS)** e não no plugin.

1. **Entrada (React):** O usuário importa a Netlist (arquivo de texto `.net` ou `.txt` que descreve os nós e componentes) do Falstad ou LTspice.
2. **Processamento (Node.js):** O JavaScript lê a Netlist, aplica os conceitos de DSP (como a *Transformada Bilinear*) e resolve as matrizes do circuito analógico.
3. **Saída (C++/JUCE):** O Node.js gera e cospe arquivos `.cpp` e `.h` estruturados com as fórmulas matemáticas já resolvidas. Em seguida, chama o CMake em segundo plano para compilar o arquivo `.vst3` final.

## 4. Exemplo Prático: Filtro Passa-Altas (High-Pass) RC de 70Hz

### Lógica executada no JavaScript (Apenas durante a conversão)
```javascript
const fc = 70.0;        // Frequência de corte (70 Hz)
const fs = 44100.0;     // Taxa de amostragem da DAW (44.1 kHz)

const omega = 2.0 * Math.PI * fc;
const K = Math.tan(omega / (2.0 * fs));
const den = K + 1.0;

const b0 = 1.0 / den;
const b1 = -1.0 / den;
const a1 = (K - 1.0) / den;

// Valores calculados que serão injetados no código C++:
// b0 = 0.995034, b1 = -0.995034, a1 = -0.990068
```

### Código C++ Gerado com Parâmetro Dinâmico de Volume
O código gerado para o JUCE busca o valor do potenciômetro uma única vez por bloco de áudio e executa uma **Equação de Diferenças** ultra-rápida dentro do loop de amostras:

```cpp
// No arquivo PluginProcessor.h (Injetado pelo JS)
float x1_left = 0.0f, y1_left = 0.0f;
float x1_right = 0.0f, y1_right = 0.0f;
juce::AudioProcessorValueTreeState apvts;

// No arquivo PluginProcessor.cpp (Injetado pelo JS dentro de processBlock)
void AudioPluginAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    auto* leftChannel  = buffer.getWritePointer (0);
    auto* rightChannel = buffer.getWritePointer (1);
    const int numSamples = buffer.getNumSamples();

    // Captura dinâmica do potenciômetro mapeado como controle (Input Range) no VST3
    const float volumeDoPotenciometro = apvts.getRawParameterValue ("volume")->load();

    // Coeficientes fixos calculados previamente pelo JavaScript
    const float b0 = 0.995034f;
    const float b1 = -0.995034f;
    const float a1 = -0.990068f;

    for (int i = 0; i < numSamples; ++i)
    {
        // Canal Esquerdo (Filtro + Potenciômetro)
        float x0_left = leftChannel[i];
        float y0_left = (b0 * x0_left) + (b1 * x1_left) - (a1 * y1_left);
        x1_left = x0_left;
        y1_left = y0_left;
        leftChannel[i] = y0_left * volumeDoPotenciometro;

        // Canal Direito (Filtro + Potenciômetro)
        float x0_right = rightChannel[i];
        float y0_right = (b0 * x0_right) + (b1 * x1_right) - (a1 * y1_right);
        x1_right = x0_right;
        y1_right = y0_right;
        rightChannel[i] = y0_right * volumeDoPotenciometro;
    }
}
```