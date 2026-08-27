# Optional llama.cpp runtime

Place a complete llama.cpp distribution here when `llama-server` is not on the
PATH and no compatible LM Studio backend is installed. On Windows this means
`llama-server.exe` plus all DLLs shipped beside it.

The node also accepts the `H3_CHAT_LLAMA_SERVER` environment variable. It never
starts the LM Studio application or service.
