# Higgsfield Seedance 2.5 demo

This is a server-side Python integration. Install with:

```powershell
py -3.14 -m pip install -r demos/higgsfield/requirements.txt
```

Put `HF_KEY=key-id:key-secret` in the repository's ignored `.env.local` file. The scripts also accept a `.env.local` in the parent workspace, for this local setup. Never put credentials in `web/` or in a commit.

Run the billable 5-second API smoke test:

```powershell
py -3.14 demos/higgsfield/main.py
```

`product_shot.py` makes a separate billable five-second product concept shot. Both scripts wait for `subscribe` to finish, reject terminal failure states, and print a video URL only when a completed result contains one.

`build_demo.py` edits the existing OptiFrame hero clip, saved user capture still, and wizard screenshots into a narrated demo under `~/Downloads/OptiFrame-Demo/`. The capture scene is explicitly labeled as animated from a still. The optional Higgsfield product shot is labeled as a concept visual, since its geometry is generative and cannot verify a printable part.
