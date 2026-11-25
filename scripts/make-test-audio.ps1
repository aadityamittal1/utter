# Generates the small speech fixtures used by the STT tests/benchmark.
# Windows only (System.Speech). Output: 16 kHz mono 16-bit PCM WAVs.
param([string]$OutDir = (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\tests\fixtures"))
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function New-Speech([string]$name, [string]$text) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SetOutputToWaveFile((Join-Path $OutDir $name), $fmt)
    $synth.Speak($text)
    $synth.Dispose()
}

New-Speech "hello.wav" "Hello world, this is a test of Utter."
New-Speech "ten_seconds.wav" "Hey Sam, um, can you send me the quarterly report by Friday? Actually, make that Thursday. Thanks so much, I really appreciate it."

# 2 s of digital silence: 44-byte header + 64000 zero bytes.
$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ms)
$data = 16000 * 2 * 2
$w.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $w.Write([int](36 + $data)); $w.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
$w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1); $w.Write([int]16000); $w.Write([int]32000); $w.Write([int16]2); $w.Write([int16]16)
$w.Write([Text.Encoding]::ASCII.GetBytes("data")); $w.Write([int]$data); $w.Write((New-Object byte[] $data))
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $OutDir "silence.wav"), $ms.ToArray())
Get-ChildItem $OutDir -Filter *.wav | Select-Object Name, Length
