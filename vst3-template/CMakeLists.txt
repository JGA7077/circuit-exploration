cmake_minimum_required(VERSION 3.20)
project(CircuitPlugin VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Download JUCE automaticamente
include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG master
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(CircuitPlugin
    COMPANY_NAME "CircuitExploration"
    PLUGIN_MANUFACTURER_CODE CExp
    PLUGIN_CODE Ckt1
    FORMATS VST3
    NEEDS_MIDI_INPUT OFF
    NEEDS_MIDI_OUTPUT OFF
    IS_SYNTH OFF
    EDITOR_REQUIRED OFF
)

juce_generate_juce_header(CircuitPlugin)

target_sources(CircuitPlugin
    PRIVATE
        PluginProcessor.cpp
        PluginProcessor.h
        PluginEditor.cpp
        PluginEditor.h
)

target_compile_definitions(CircuitPlugin PRIVATE
    JUCE_IGNORE_VST3_MISMATCHED_PARAMETER_ID_WARNING=1
)
