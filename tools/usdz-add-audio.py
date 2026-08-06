#!/usr/bin/env python3
"""
Embarque une piste audio dans un fichier .usdz, pour AR Quick Look (iOS).

Pourquoi cet outil
──────────────────
Sur Android, le son de la scène RA est piloté par la page : l'événement
« object-placed » de model-viewer indique quand le modèle est posé, et
Scene Viewer accepte un paramètre « sound » dans son intent.

Sur iOS, rien de tout cela n'existe. AR Quick Look est une app native : la
page ne reçoit aucun événement de pose, et la session audio d'ARKit
interrompt de toute façon celle du navigateur dès l'ouverture. Le seul son
que Quick Look joue est celui contenu DANS le .usdz, et il le démarre avec
la timeline de la scène — c'est-à-dire au moment où le modèle apparaît
dans le monde réel.

Ce que fait le script
─────────────────────
Il ajoute au modèle un prim SpatialAudio enfant du prim par défaut, puis
réempaquette modèle, textures et audio dans un nouveau .usdz conforme à
AR Quick Look. La géométrie et les matériaux ne sont pas modifiés, et le
paquet produit est relu pour vérifier que rien n'a été cassé.

    ./tools/usdz-add-audio.py porte.usdz ambiance.mp3 porte-sonore.usdz

Formats acceptés par USDZ : M4A, MP3, WAV (M4A recommandé pour le poids).

Dépendance : python3 -m pip install usd-core
"""

import shutil
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    from pxr import Sdf, Usd, UsdMedia, UsdUtils
except ImportError:
    sys.exit("USD manquant : python3 -m pip install usd-core")

AUDIO_EXT = {".m4a", ".mp3", ".wav"}
AUDIO_PRIM = "JojAmbience"

# loopFromStage : la piste tourne en boucle tant que la scène est jouée.
# Quick Look démarre la scène à la pose du modèle, le son suit donc
# exactement la présence de l'objet dans le monde réel. Pour un son qui
# ne passe qu'une fois : "onceFromStart".
PLAYBACK_MODE = "loopFromStage"

# nonSpatial : volume constant, indépendant de la position du spectateur.
# "spatial" ferait décroître le son quand on s'éloigne du modèle.
AURAL_MODE = "nonSpatial"


def unpack(usdz: Path, dest: Path) -> Path:
    """Extrait le paquet et renvoie le chemin de son calque racine.

    Le premier fichier d'un .usdz est, par spécification, le calque racine.
    """
    with zipfile.ZipFile(usdz) as z:
        names = z.namelist()
        if not names:
            sys.exit(f"{usdz.name} : paquet vide")
        z.extractall(dest)
        return dest / names[0]


def asset_report(stage: Usd.Stage) -> tuple[int, list[str]]:
    """Compte les chemins d'assets qui résolvent, et liste ceux qui échouent."""
    ok, broken = 0, []
    for prim in stage.Traverse():
        for attr in prim.GetAttributes():
            if attr.GetTypeName() != "asset":
                continue
            value = attr.Get()
            if value is None:
                continue
            if value.resolvedPath:
                ok += 1
            else:
                broken.append(f"{prim.GetPath()}.{attr.GetName()} → {value.path}")
    return ok, broken


def add_audio(usdz_in: Path, audio: Path, usdz_out: Path) -> None:
    if audio.suffix.lower() not in AUDIO_EXT:
        sys.exit(f"format non supporté par USDZ : {audio.suffix} "
                 f"(attendu : {', '.join(sorted(AUDIO_EXT))})")

    with TemporaryDirectory() as tmp:
        work = Path(tmp)
        root_layer = unpack(usdz_in, work)

        # l'audio voyage dans le paquet, à côté du calque racine
        shutil.copy2(audio, work / audio.name)

        stage = Usd.Stage.Open(str(root_layer))
        if not stage:
            sys.exit(f"{usdz_in.name} : illisible par USD")

        default_prim = stage.GetDefaultPrim()
        if not default_prim:
            sys.exit(f"{usdz_in.name} : pas de defaultPrim, Quick Look ne "
                     f"saurait pas quoi afficher")

        # Enfant du prim par défaut : le son doit se trouver dans le
        # sous-arbre que Quick Look joue réellement.
        path = default_prim.GetPath().AppendChild(AUDIO_PRIM)
        if stage.GetPrimAtPath(path):
            sys.exit(f"{usdz_in.name} : {path} existe déjà — ce modèle a "
                     f"probablement déjà été traité")

        spatial = UsdMedia.SpatialAudio.Define(stage, path)
        spatial.CreateFilePathAttr(Sdf.AssetPath(audio.name))
        spatial.CreateAuralModeAttr(AURAL_MODE)
        spatial.CreatePlaybackModeAttr(PLAYBACK_MODE)
        stage.GetRootLayer().Save()

        # Variante ARKit de l'empaquetage : c'est celle qui produit la
        # structure attendue par AR Quick Look.
        usdz_out.parent.mkdir(parents=True, exist_ok=True)
        if not UsdUtils.CreateNewARKitUsdzPackage(
                Sdf.AssetPath(str(root_layer)), str(usdz_out)):
            sys.exit("échec de l'empaquetage .usdz")


def verify(usdz_in: Path, usdz_out: Path, audio_name: str) -> None:
    """Relit le paquet produit : le son est là, et le modèle est intact."""
    with zipfile.ZipFile(usdz_out) as z:
        names = z.namelist()
    if not any(n.endswith(audio_name) for n in names):
        sys.exit(f"vérification : {audio_name} absent du paquet")

    stage = Usd.Stage.Open(str(usdz_out))
    if not stage:
        sys.exit("vérification : paquet illisible par USD")

    if not stage.GetDefaultPrim():
        sys.exit("vérification : defaultPrim perdu")

    found = [p for p in stage.Traverse() if p.IsA(UsdMedia.SpatialAudio)]
    if not found:
        sys.exit("vérification : aucun prim SpatialAudio")

    spatial = UsdMedia.SpatialAudio(found[0])
    if not spatial.GetFilePathAttr().Get().resolvedPath:
        sys.exit("vérification : le chemin audio ne résout pas")

    # Le modèle ne doit pas avoir perdu de texture au réempaquetage.
    before, _ = asset_report(Usd.Stage.Open(str(usdz_in)))
    after, broken = asset_report(stage)
    if broken:
        sys.exit("vérification : assets cassés —\n  " + "\n  ".join(broken))
    if after != before + 1:
        sys.exit(f"vérification : {before} assets avant, {after} après "
                 f"(attendu {before + 1})")

    print(f"  prim audio  : {found[0].GetPath()}")
    print(f"  lecture     : {spatial.GetPlaybackModeAttr().Get()} / "
          f"{spatial.GetAuralModeAttr().Get()}")
    print(f"  defaultPrim : {stage.GetDefaultPrim().GetPath()}")
    print(f"  assets      : {after} résolus, aucun cassé")
    print(f"  paquet      : {', '.join(names)}")


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit("usage : usdz-add-audio.py <entrée.usdz> <audio.mp3> <sortie.usdz>")

    usdz_in, audio, usdz_out = (Path(a) for a in sys.argv[1:4])
    for f in (usdz_in, audio):
        if not f.is_file():
            sys.exit(f"fichier introuvable : {f}")

    add_audio(usdz_in, audio, usdz_out)
    verify(usdz_in, usdz_out, audio.name)

    print(f"\n{usdz_out} — {usdz_out.stat().st_size / 1e6:.2f} Mo "
          f"(modèle {usdz_in.stat().st_size / 1e6:.2f} Mo "
          f"+ audio {audio.stat().st_size / 1e6:.2f} Mo)")


if __name__ == "__main__":
    main()
