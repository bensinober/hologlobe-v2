# HoloGlobe V2

An insanely and even more impractical 3D hologram rotating sphere POV (persistence of vision)

![pov 1](images/hologlobe.png)
![pov 2](images/pov-globe-2.png)

## What does it do?

It spins a frame mount of programmable leds and updates insanely fast so that an image
is formed on a spherical shape. Due to the persistent nature of the eye, this is perceived
by the viewer as a floating semi-transparent image.

## How is it done?

3d-printed frame (two spheres) and connectors, an RC speedboat engine and some rough electronics.
The spinning frame is made by two programmable led strips handled by a Raspberry PI

## What can it show?

Spherical shapes mapped out on a 50x100 matrix, globes, death stars, heads, whatever.

![earth-rotated](images/output_50x100.png)

## Is it dangerous?

Nah, though it may accidentaly toss things in your eyes.

## I want to try!

clone this repo and continue to [Installation](docs/Installation.md)
and  [Documentation](docs/Documentation.md)

## Documentation

[Separate documentation](docs/Documentation.md)

## Prerequisites

* Raspberry with installed Raspbian Trixie (RPI3b+ or newer 64bit)
* 3D-printer access
* coding skills

[more info](docs/Prerequisites.md)

## Data

frame thickness: 5.7
frame width: 18
frame outer rad: 140
frame inner: 6.6
frame spines dia: 12
frame spines len: 18