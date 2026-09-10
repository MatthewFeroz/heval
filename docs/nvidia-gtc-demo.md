# A personal NVIDIA model evaluation

Checked September 10, 2026 against NVIDIA's model cards, Hugging Face API and direct API catalog. The repository's Merge catalog snapshot is dated September 2; use the live preflight before making requests.

## Recommended models and harness

Use **Nemotron 3.5 Lightning versus Nemotron 3 Super in Pi**, with the same task and wall-clock limit. Pi is an MIT-licensed open-source coding-agent harness, already pinned here at `0.84.4`. Its custom-provider configuration supports OpenAI-compatible Chat Completions and tools, which fits Merge Gateway and NVIDIA's API. Heval provides execution isolation, grading, recorded history and the chart workflow around it.

| Model | What the current sources establish | Demo fit |
| --- | --- | --- |
| Nemotron 3.5 Lightning 30B-A3B | NVIDIA's model card says August 11, 2026; 30B total and 3B active parameters; coding and tool-use evaluations; OpenMDW 1.1 license | Primary model for the coding demonstration |
| Nemotron 3 Super 120B-A12B | Listed in NVIDIA's live inference catalog and the saved Merge tool-calling catalog | Larger-model comparison |
| Nemotron 3 Ultra 550B-A55B | Listed in NVIDIA's live inference catalog | Optional later comparison; do not assume the same ID exists on Merge |
| Nemotron 3 Labs Ultra Math RL/SFT | September 3, 2026 release focused on mathematical reasoning and proofs | Newer specialist release, but not the first choice for this coding task |

NVIDIA also publishes optimized versions of other organizations' models. A recent `nvidia/` upload is not necessarily a newly released NVIDIA-authored model. Use the actual model card's release date and purpose.

Sources:

- [Lightning model card and release date](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16)
- [Lightning deployment variant](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)
- [Ultra model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16)
- [September Ultra Math release](https://huggingface.co/nvidia/Nemotron-3-Labs-Ultra-Math-RL)
- [NVIDIA's live API model catalog](https://integrate.api.nvidia.com/v1/models)
- [Pi source and MIT license](https://github.com/earendil-works/pi)

## Model IDs depend on the provider

| Model | Merge Gateway ID from the saved catalog | NVIDIA direct API ID |
| --- | --- | --- |
| Lightning | `nvidia/nemotron-3.5-lightning-30b-a3b` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Super | `nvidia/nemotron-super-3-120b` | `nvidia/nemotron-3-super-120b-a12b` |
| Ultra | Not established by the saved Merge catalog | `nvidia/nemotron-3-ultra-550b-a55b` |

The saved Merge catalog lists Lightning through `nvidia` and Super through `bedrock`, both with tool calling. Different serving vendors can affect latency. The demo preflight checks current availability and preserves requested vendor pins in its protocol. It does not independently verify the served vendor from response headers, so exported vendor fields remain unknown. Do not describe latency differences as purely architectural.

## Run a fresh comparison

Use a credential authorized for this independent project. Put it in `.env.local` as `HEVAL_GATEWAY_API_KEY`; never commit or show the file in a screen recording.

```sh
bun install --frozen-lockfile
bun run worker:build
bun run demo:nvidia
```

The last command only checks the live model catalog. When ready to make two model-backed attempts:

```sh
bun run demo:nvidia --run
```

This runs Pi sequentially on the pinned `concurrent-cache-v1` fixture, once per model, with five minutes per agent. A local inference proxy keeps the Gateway key out of the worker and caps each attempt at 40 inference requests with 8192 output tokens per response. It writes a protocol, private recordings and a normalized comparison under `data/nvidia-demo/<timestamp>/`. Interrupted or infrastructure-failed attempts are not silently converted to failing model scores. The script does not publish results.

For the browser workflow, configure WorkOS and these server values:

```dotenv
HEVAL_ENABLE_RUNNER=1
HEVAL_GATEWAY_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
HEVAL_ALLOWED_MODELS=nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/nemotron-super-3-120b
```

The CLI preserves catalog-checked vendor pins; browser BYOK uses Gateway routing. Start the full app with `HEVAL_ENABLE_EXPORTS=1 bun run start`, sign in, open **Provider settings**, validate your Merge Gateway key, launch each model with Pi, select both saved attempts, and choose **Compare in Studio**. Private comparisons require their owner's login; use a downloaded Bundle or an explicitly published result for other viewers.

Direct NVIDIA access remains available through the trusted runner adapters, separate from browser BYOK. Set `HEVAL_PROVIDER=nvidia` and `HEVAL_NVIDIA_API_KEY`, use the direct model IDs in `HEVAL_GATEWAY_MODEL` and `HEVAL_ALLOWED_MODELS`, and select Pi. Catalog presence alone does not prove that a particular model/API combination completes an agent run. Validate with a real attempt before recording claims about it.

## A 30–45 second Instagram walkthrough

1. Introduce Heval: “I'm building an open-source workbench to see what coding agents actually fix.”
2. Show the selected NVIDIA model, Pi harness, task and time limit. Launch or open a genuinely completed attempt.
3. Show terminal activity and the independent grader's result. If you speed up or cut a long run, label that edit.
4. Open the two attempts in Studio and show the measured pass result and elapsed time. Missing usage or pricing should remain visibly unavailable.
5. End on the chart and source link. Say “This is one task, one attempt per model,” unless you actually ran a larger protocol.

Do not reuse the company comparison, internal task outputs, company branding, or claim personal ownership of company work. The public build starts with an empty catalog and uses a separate landing page. Publish only the new result you intend to share.

The entry instructions supplied for this project require `#NVIDIAGTC` and tagging the judge you heard about the challenge from. Use that judge's verified Instagram handle; do not guess a handle. Those instructions list September 10, 2026 as the submission deadline. Check the official terms for the deadline's timezone and eligibility before posting. No post or contest submission is made by these scripts.
