{
  "targets": [
    {
      "target_name": "da_pcap",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["-lws2_32", "-liphlpapi"],
            "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1 } }
          }
        ],
        ["OS!='win'", { "sources": [] }]
      ]
    }
  ]
}
