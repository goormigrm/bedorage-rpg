# (UTF-8 BOM 으로 저장 — 윈도 PowerShell 5.1 은 BOM 이 없으면 한글을 깨뜨린다)
# 보스 즉사기 대사 목소리 (2026-09-24 사용자: "TTS 는 트레일러에 담지 말고 별도의 동영상으로 4개의 보스에 대해서 모두 TTS 음성 녹화").
# 같은 날 사용자: "여자 음성에 너무 단조로워 임팩트가 없다 — 에코를 많이 넣거나 음을 내려 어떤 TTS 가 선택되더라도 울리면서 웅장하게".
# 브라우저 음성 합성(speechSynthesis)의 소리는 WebAudio 로 가공할 수 없다 → 윈도 한국어 목소리(Microsoft Heami — SAPI)로
# 대사 넷을 짧은 WAV 로 만들어 게임에 싣고(public/voice), 게임(audio/sfx.ts bossLine)과 영상이 **같은 가공**(음 내리기 · 겹치기 ·
# 거친 맛 · 저음 · 메아리 · 긴 잔향)을 건다. 가공에서 재생 빠르기를 늦춰(음이 내려간다) 여기서는 조금 빠르게 읽힌다.
#
#   powershell -ExecutionPolicy Bypass -File tools/bossvoice.ps1      → public/voice/boss_<보스 번호>.wav (24 kHz 모노)
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot '..\public\voice'
New-Item -ItemType Directory -Force $out | Out-Null
$lines = @(
  @{ kind = 3;  text = '신선한 고기다…!';                pitch = '-20%'; rate = '+15%' },
  @{ kind = 8;  text = '내 곁으로 오너라, 아이들아…';      pitch = '+10%'; rate = '+5%' },
  @{ kind = 12; text = '내 앞에 선 자, 목을 내놓아라!';    pitch = '-25%'; rate = '+15%' },
  @{ kind = 15; text = '심연이 모두를 삼키리라.';          pitch = '-30%'; rate = '+10%' }
)
foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice('Microsoft Heami Desktop')
  $path = Join-Path $out ("boss_{0}.wav" -f $l.kind)
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($path, $fmt)
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ko-KR'><voice name='Microsoft Heami Desktop'><prosody pitch='$($l.pitch)' rate='$($l.rate)'>$($l.text)</prosody></voice></speak>"
  $s.SpeakSsml($ssml)
  $s.SetOutputToNull()
  $s.Dispose()
  "{0} {1} bytes" -f $path, (Get-Item $path).Length
}
