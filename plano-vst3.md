# Plano: Conversor de Circuitos (Falstad/LTSpice) para VST3

## Stack
- **Front-end/Conversão**: JS/React (existente)
- **Plugin VST3**: C++/JUCE + chowdsp_wdf
- **Build**: CMake + Ninja + MSVC Build Tools
- **IDE**: VS Code

---

## Fase 0 — Setup das Ferramentas

- [ ] Instalar Microsoft C++ Build Tools (standalone, sem VS IDE)
  - Download: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
  - Selecionar: "Desktop development with C++"
- [ ] Instalar CMake (>= 3.20)
  - `winget install Kitware.CMake` ou https://cmake.org/download/
- [ ] Instalar Ninja
  - `winget install Ninja-build.Ninja` ou https://ninja-build.org/
- [ ] Clonar/baixar JUCE (https://github.com/juce-framework/JUCE)
- [ ] Verificar compilação: JS gera JUCE template mínimo → CMake build → `.vst3` válido
- [ ] Adicionar botão "Generate VST3" no React (esqueleto)

---

## Fase 1 — Prova de Conceito: Filtro RC Linear

**Target**: Circuito RC série → VST3 com filtro passa-baixa funcional na DAW

- [ ] Criar `src/utils/circuitToVST3.js`:
  - [ ] Reaproveitar parser existente de `functions.js`
  - [ ] Identificar IN (fonte SINE), OUT (probe O), GND
  - [ ] Aplicar Transformada Bilinear → coeficientes `b0, b1, a1`
  - [ ] Gerar `PluginProcessor.cpp` com equação de diferenças fixa
  - [ ] Gerar `PluginProcessor.h` com declarações
  - [ ] Gerar `CMakeLists.txt` (FetchContent JUCE)
  - [ ] Salvar em pasta `generated-vst3/<nome>/`
- [ ] Compilar com CMake via Node.js (`child_process.exec`)
- [ ] Testar VST3 na DAW (entrada → filtro RC → saída)
- [ ] Adicionar potenciômetro como `AudioParameterFloat` (ex: frequência de corte)
- [ ] Expandir `circuitToVST3.js` para gerar filtro passa-altas, passa-faixa

---

## Fase 2 — Mini-Fuzz com Não-Linearidades (WDF)

**Target**: Mini-fuzz (BC517 + 1N4148 + pot) → VST3 com parâmetros

- [ ] Adicionar `chowdsp_wdf` ao template (header-only, copiar para o projeto)
- [ ] Mapear topologia do mini-fuzz para árvore WDF:
  ```
  IN → C2 → R1_bias → Q1(BC517) → D1 → C1 → POT → OUT
  ```
- [ ] No JS, gerar código C++ com a árvore WDF montada
- [ ] Potenciômetros → `AudioParameterFloat` expostos na DAW
- [ ] Diodo 1N4148 → WDF diode model
- [ ] Transistor BC517 → modelo WDF simplificado (ou tabela lookup)
- [ ] Compilar e testar na DAW
- [ ] Comparar resposta em frequência com simulação LTSpice

---

## Fase 3 — Conversor Universal (MNA + WDF Híbrido)

**Target**: Qualquer circuito Falstad → VST3 automaticamente

- [ ] Construir gerador de matriz MNA no JS:
  - [ ] Grafo do circuito → matriz de admitância G + matriz de capacitância C
  - [ ] Identificar nós IN/OUT/GND automaticamente
  - [ ] Discretizar com trapezoidal: `(2/T) * C + G`
  - [ ] Resolver sistema linear no JS (Eliminação Gaussiana)
  - [ ] Pré-fatorar matriz (LU decomposition) → C++ gerado faz só substituição
- [ ] Não-linearidades:
  - [ ] Diodo: Newton-Raphson por amostra
  - [ ] Transistor: modelo Ebers-Moll simplificado ou WDF local
- [ ] Gerar C++ otimizado com topologia fixa
- [ ] Build automático → `.vst3`
- [ ] Testar com 3+ circuitos diferentes (RC, mini-fuzz, outro pedal)

---

## Notas Técnicas

### JUCE sem UI
```cpp
// PluginProcessor.h
class AudioPluginAudioProcessor : public juce::AudioProcessor {
    juce::AudioProcessorValueTreeState apvts;
    // parâmetros expostos à DAW
};

// PluginEditor (vazio por enquanto)
class AudioPluginAudioProcessorEditor
    : public juce::AudioProcessorEditor {
    // constructor vazio, sem UI
};
```

### WDF com chowdsp_wdf
```cpp
#include "chowdsp_wdf/chowdsp_wdf.h"

// Exemplo: resistor + capacitor série (filtro RC)
using Capacitor = chowdsp_wdf::CapacitorT<float>;
using Resistor  = chowdsp_wdf::ResistorT<float>;
using WDFSeries = chowdsp_wdf::SeriesT<float, Resistor, Capacitor>;

auto capacitor = std::make_unique<Capacitor>(1.0e-6f, 44100.0f);
auto resistor = std::make_unique<Resistor>(1000.0f);
auto circuit = std::make_unique<WDFSeries>(*resistor, *capacitor);
```

### Tamanhos estimados
| Item | Espaço |
|---|---|
| C++ Build Tools | ~3-4 GB |
| CMake + Ninja | ~100 MB |
| JUCE (FetchContent) | ~150 MB |
| Projeto gerado | ~5-10 MB |
| VS Code + extensões | ~1 GB |
| **Total** | **~4-6 GB** |
