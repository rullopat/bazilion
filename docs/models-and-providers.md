# Models and providers

**Setup → Models** (`/config`) is sorted by what a model does for your Agents:

- **Chat**: the models Agents think with. Each Agent and each Agent template uses one of them.
- **Images**: what Agents draw with ([image generation](image-generation.md)).
- **Providers**: the accounts and local servers those models run on.

A line above the cards says whether every provider answers, and names the one that does not.

## Connect a provider

A provider is connected in one step. In the web UI press **Add a provider**, choose one, paste its
key (or sign in with ChatGPT, or give a local server's address), leave the suggested models ticked
or choose others, and press **Connect and test**. From a terminal:

```sh
bazilion provider connect anthropic                 # asks for the key without echoing it
bazilion provider connect openai --key sk-…  --models gpt-6.1-sol,gpt-6-luna
bazilion provider connect lmstudio --url http://127.0.0.1:1234/v1
bazilion auth openai login && bazilion provider connect openai-codex    # a ChatGPT plan
```

Connecting asks the cheapest chosen model for a short reply first. Only when it answers are the
key, the models and the on switch saved, so a key that does not work is never stored. A model the
provider refuses for your account is left out and the next one is asked. **Save without testing**
(`--no-test`) skips the request and leaves the provider "not tested".

On a first run, `/welcome` is the same step on one screen: choose, connect, **Start chatting**.
**On this computer** looks for LM Studio, Ollama and llama.cpp at their usual addresses.

`--set NAME=value` sets any other field of a provider (`bazilion provider models <id>` lists
their names). A provider whose credentials come from the daemon's environment (Amazon Bedrock,
Google Vertex AI) connects without a key.

## What a provider's state means

| State | |
| --- | --- |
| Working | Its last test got a reply; the page says when |
| Key rejected, Not answering, Model unavailable, Limit reached | Its last test failed; the provider's sheet has what to do and the provider's own message |
| Not tested yet | Saved without a test, or its key or models changed since |
| Needs a key | Switched on, but its credentials are gone |
| Turned off | Paused; what is saved stays saved |
| Saved, not in use | A key was saved but no model chosen, as 0.50 allowed; **Connect** chooses its models and tests it |

Nothing asks a provider on its own: a state is the outcome of connecting, of **Test again**
(`bazilion provider test <id>`) or of `bazilion provider test <provider:model>`. Changing a
provider's key or address makes it "not tested" again.

```sh
bazilion provider list                # the providers in use, with their state
bazilion provider list --all          # every provider Bazilion knows
bazilion provider test anthropic      # ask its cheapest model in Chat
bazilion provider disable anthropic   # pause it; enable switches it back on
bazilion provider disconnect anthropic   # remove its key, its models and its test
```

A provider cannot be switched on without credentials. Disconnecting removes the stored key or
sign-in; a key two providers share stays while the other one is on.

## Chat models

**Add models** lists every model of the connected providers with its name, how much it can read,
whether it takes images, whether it reasons, and its list price per million tokens. These facts
come from the catalog bundled with Pi; models a provider reports that the catalog does not know
are listed by id. A local server lists what it has loaded.

```sh
bazilion provider models anthropic                         # in use, and offered
bazilion provider models-set anthropic claude-fable-5-2,claude-haiku-5-5
```

Each row on the page says who uses the model. Removing a model an Agent template defaults to
moves the template to another model and says so; an Agent with its own model on a removed model
is refused until it gets another one in its **Agent** tab.

## Settings and precedence

A provider's fields are settings like any other: `bazilion config set ANTHROPIC_API_KEY …` writes
one without connecting, and a value in the daemon's own environment wins over the stored one.
Secrets are stored encrypted. The record of tests is kept in the home and is never part of an
Agent's or a tool's environment.

## HTTP

| | |
| --- | --- |
| `GET /api/config/providers` | Every provider with its state; asks no provider anything |
| `GET /api/config/models` | Chat models with who uses them, and the image routes |
| `GET /api/config/providers/local` | Local model servers found at their addresses |
| `GET`, `POST /api/config/providers/:id/catalog` | A provider's models; `POST` takes `fields` that are not saved yet |
| `POST /api/config/providers/:id/connect` | `{ fields?, models?, test? }`: test, then save and switch on |
| `POST /api/config/providers/:id/test` | Ask its cheapest model in Chat and remember the outcome |
| `PUT /api/config/providers/:id/models`, `…/enabled` | Replace its chat models; pause or resume it |
| `DELETE /api/config/providers/:id` | Disconnect |
