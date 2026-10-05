// mkdir -p js/examples/jsm/{loaders,controls,utils}
// import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.0/build/three.module.js"
// curl -o js/three.module.js https://cdn.jsdelivr.net/npm/three@0.166.0
// curl -o js/examples/jsm/loaders/PLYLoader.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/loaders/PLYLoader.js
// curl -o js/examples/jsm/loaders/GLTFLoader.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/loaders/GLTFLoader.js
// curl -o js/examples/jsm/loaders/OBJLoader.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/loaders/OBJLoader.js
// curl -o js/examples/jsm/loaders/MTLLoader.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/loaders/MTLLoader.js
// curl -o js/examples/jsm/controls/OrbitControls.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/controls/OrbitControls.js
// curl -o js/examples/jsm/utils/BufferGeometryUtils.js https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/utils/BufferGeometryUtils.js

import * as THREE from "three"
import { OrbitControls } from "./js/examples/jsm/controls/OrbitControls.js"
import { PLYLoader } from "./js/examples/jsm/loaders/PLYLoader.js"
import { GLTFLoader } from "./js/examples/jsm/loaders/GLTFLoader.js"
import { OBJLoader } from "./js/examples/jsm/loaders/OBJLoader.js"
import { MTLLoader } from "./js/examples/jsm/loaders/MTLLoader.js" // For more complex OBJ files with MTL

const plyUpload = document.getElementById("plyUpload")
const gltfUpload = document.getElementById("gltfUpload")
const objUpload = document.getElementById("objUpload")
const outCanvas = document.getElementById("outCanvas")
const outCanvasCtx = outCanvas.getContext("2d")
const meshCanvas = document.getElementById("meshCanvas")

plyUpload.addEventListener("change", loadPLYModel)
gltfUpload.addEventListener("change", loadGLTFModel)
objUpload.addEventListener("change", loadObjModel)
document.getElementById("startBtn").addEventListener("click", start)
document.getElementById("clearBtn").addEventListener("click", clearOutCanvas)
document.getElementById("downloadBtn").addEventListener("click", downloadModel)


let mesh, camera, scene, renderer, controls, pivot
const step = Math.floor(outCanvas.width / 360) // pixel width to extract while spinning

function setupScene() {
  scene = new THREE.Scene()

  // light
  const light = new THREE.SpotLight()
  light.position.set(0, 20, 20)
  scene.add(light)
  const ambientLight = new THREE.AmbientLight(0x404040) // Soft white light
  scene.add(ambientLight)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2)
  directionalLight.position.set(1, 1, 1).normalize()
  scene.add(directionalLight)

  // camera
  camera = new THREE.PerspectiveCamera(3, window.innerWidth / window.innerHeight, 0.1, 1000)
  renderer = new THREE.WebGLRenderer({ canvas: meshCanvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  document.body.appendChild(renderer.domElement)

  // For rotating AROUND object
  pivot = new THREE.Object3D()
  pivot.position.copy(scene.position)
  scene.add(pivot)
  pivot.add(camera)
  camera.position.set(0, 0, 0)

  // controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
}

// async file api wrapper to arraybuffer
function readFileAsync(file) {
  return new Promise((resolve, reject) => {
    let reader = new FileReader()
    reader.onload = () => {
      resolve(reader.result)
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// PLY pointcloud to mesh
async function loadPLYModel(evt) {
  const file = plyUpload.files[0]
  if (!file) {
    alert("Please select a PLY file to upload.")
    return
  }
  try {
    const arrayBuffer = await readFileAsync(file)
    const loader = new PLYLoader()
    const geometry = loader.parse(arrayBuffer)
    //geometry.computeVertexNormals() // Important for proper lighting
    // Texture
    //const textureLoader = new THREE.TextureLoader()
    //const colorTexture = textureLoader.load("textures/brick_color.jpg") // Replace with your texture path
    const material = new THREE.MeshStandardMaterial({
      color: 0x0000ff00, // Example color, or use vertex colors if available in PLY
      flatShading: false,
    })
    mesh = new THREE.Mesh(geometry, material)
    // Fix rotation
    mesh.rotateX(-Math.PI / 2)
    //mesh.rotateZ(-Math.PI / 2)
    //mesh.rotateY(-Math.PI / 2)
    scene.add(mesh)
    animate()
  } catch (err) {
    console.error("An error occurred while loading the PLY model:", err)
  }
}

async function loadGLTFModel(evt) {
  const file = gltfUpload.files[0]
  if (!file) {
    alert("Please select an GLB file to upload.")
    return
  }
  try {
    const arrayBuffer = await readFileAsync(file)
    // Load the OBJ model
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(arrayBuffer)
    console.log(gltf, arrayBuffer)
    scene.add(gltf.scene)

    // Optional: Access and manipulate textures or materials if needed
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        // Example: Check if a material has a map (texture)
        if (child.material.map) {
          console.log('Texture found on:', child.name)
        }
      }
    })
    animate()
  } catch (err) {
    console.error("An error occurred while loading the GLTF model:", err)
  }
}
async function loadObjModel(evt) {
  const file = objUpload.files[0]
  if (!file) {
    alert("Please select an OBJ file to upload.")
    return
  }
  try {
    const arrayBuffer = await readFileAsync(file)
    // Load the OBJ model
    const loader = new OBJLoader()
    const mtlLoader = new MTLLoader()
    const materials = await mtlLoader.loadAsync("./models/benhead/benhead.mtl")
    materials.preload()
    loader.setMaterials(materials)
    const object = loader.parse(new TextDecoder().decode(arrayBuffer))
    scene.add(object)
    animate()
  } catch (err) {
    console.error("An error occurred while loading the OBJ model:", err)
  }
}

// capture vertical center of rotating model in step width
function capture(num) {
  const imgDataUrl = renderer.domElement.toDataURL()
  const img = new Image()
  img.src = imgDataUrl

  img.onload = () => {
    const tempCanvas = document.createElement("canvas")
    tempCanvas.width = img.width
    tempCanvas.height = img.height
    const tempCtx = tempCanvas.getContext("2d")
    tempCtx.drawImage(img, 0, 0)
    const centerX = meshCanvas.width / 2
    const centerY = meshCanvas.height / 2
    const x = centerX - (step / 2)
    const y = centerY - 300
    const width = step
    const height = 600

    const imageData = tempCtx.getImageData(x, y, width, height)
    const croppedCanvas = document.createElement("canvas")
    // put on large canvas
    outCanvasCtx.putImageData(imageData, num * step, 0)
    //outCanvasCtx.drawImage(imageData, num + 10, 0)

  }
}

var lastRotation = 0
let capturing = false
var imgCount = 0

// rorate scene and capture for every degree until fully rotated once
function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
  //mesh.rotation.z += 0.01
  //const currentRotationYInDegrees = THREE.MathUtils.radToDeg(mesh.rotation.y);
  pivot.rotation.y += 0.01
  const currentRotationYInDegrees = THREE.MathUtils.radToDeg(pivot.rotation.y);
  if (capturing) {
    const rot = Math.floor(currentRotationYInDegrees)
    // to capture once per degree rotation
    if (imgCount >= 360) {
      console.log("doneCapture")
      capturing = false
      downloadBtn.removeAttribute("disabled")
      pivot.rotation.y = 0
    } else if (rot > lastRotation) {
      capture(imgCount)
      //console.log("capture", imgCount, "rot", rot)
      imgCount++
      lastRotation = rot
    }
  }
}

function downloadModel(evt) {
  const outCanvasUrl = outCanvas.toDataURL("image/png")
  const link = document.createElement("a")
  link.href = outCanvasUrl
  link.download = "model.png"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function start() {
  console.log("START CAPTURE")
  capturing = true
}

function clearOutCanvas() {
  console.log("CLEAR CAPTURE")
  outCanvasCtx.clearRect(0, 0, outCanvas.width, outCanvas.height)
  imgCount = 0
}

export { setupScene, loadPLYModel, loadGLTFModel, loadObjModel, downloadModel }
