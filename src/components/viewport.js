import React from 'react';
import Stats from 'stats-js';
import Arrow from 'amphion/src/primitives/Arrow';
import {
  MESSAGE_TYPE_POSESTAMPED,
  MESSAGE_TYPE_POSECOVARIANCE,
} from 'amphion/src/utils/constants';
import { NAV_ARROW_COLOR, NAV_ARROW_CONFIG } from '../utils/defaults';
import ViewPortTransformControls from './transformControls';

const { THREE, devicePixelRatio } = window;

class Viewport extends React.Component {
  constructor(props) {
    super(props);
    this.container = React.createRef();

    this.previousWidth = 0;
    this.previousHeight = 0;

    this.controls = null;
    this.transformControlsEnabled = true;
    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.rayIntersection = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.arrow = new Arrow();
    this.setupNavArrow();

    this.onWindowResize = this.onWindowResize.bind(this);
    this.animate = this.animate.bind(this);
    this.initRenderer = this.initRenderer.bind(this);
    this.initGrid = this.initGrid.bind(this);
    this.initStats = this.initStats.bind(this);

    this.setMouse = this.setMouse.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);

    this.enableEditorControls = this.enableEditorControls.bind(this);
    this.disableEditorControls = this.disableEditorControls.bind(this);
  }

  componentDidMount() {
    const { camera, onRef, scene } = this.props;
    const container = this.container.current;

    window.scene = scene;
    this.initStats();
    this.initRenderer();
    this.initGrid();

    this.controls = new THREE.EditorControls(camera, container);
    this.controls.enableDamping = true;
    window.addEventListener('resize', this.onWindowResize);
    requestAnimationFrame(this.animate);
    this.onWindowResize();

    onRef(this);
  }

  componentWillUnmount() {
    const { onRef } = this.props;

    window.removeEventListener('resize', this.onWindowResize);
    onRef(undefined);
  }

  onWindowResize() {
    const { camera } = this.props;
    const container = this.container.current;
    const { offsetWidth, offsetHeight } = container;
    if (
      Math.abs(offsetWidth - this.previousWidth) > 10 ||
      Math.abs(offsetHeight - this.previousHeight) > 10
    ) {
      camera.aspect = container.offsetWidth / container.offsetHeight;
      camera.updateProjectionMatrix();
      this.renderer.setSize(container.offsetWidth, container.offsetHeight);
      this.previousWidth = offsetWidth;
      this.previousHeight = offsetHeight;
    }
  }

  setupNavArrow() {
    this.arrow.setShaftDimensions(NAV_ARROW_CONFIG.shaft);
    this.arrow.setHeadDimensions(NAV_ARROW_CONFIG.head);
    this.arrow.setColor({
      cone: new THREE.Color(NAV_ARROW_COLOR),
      cylinder: new THREE.Color(NAV_ARROW_COLOR),
    });
  }

  animate() {
    const { scene, camera } = this.props;
    this.stats.begin();
    scene.updateMatrixWorld();

    this.renderer.render(scene, camera);
    this.stats.end();
    requestAnimationFrame(this.animate);
  }

  initRenderer() {
    const container = this.container.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.autoClear = false;
    renderer.autoUpdateScene = false;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    this.renderer = renderer;
    container.appendChild(this.renderer.domElement);
  }

  initGrid() {
    const { scene } = this.props;
    const grid = new THREE.GridHelper(30, 30, 0x333333, 0x222222);

    scene.background = new THREE.Color(0x000000);
    grid.geometry.rotateX(Math.PI / 2);
    scene.add(grid);
    const { array } = grid.geometry.attributes.color;
    for (let i = 0; i < array.length; i += 60) {
      for (let j = 0; j < 12; j += 1) {
        array[i + j] = 0.26;
      }
    }
  }

  setMouse(event) {
    const { clientX, clientY } = event;
    const { width, height } = this.renderer.domElement;

    const canvasRect = event.target.getBoundingClientRect();
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;

    this.mouse.x = ((x * devicePixelRatio) / width) * 2 - 1;
    this.mouse.y = -((y * devicePixelRatio) / height) * 2 + 1;
  }

  castRay() {
    const { camera } = this.props;
    this.raycaster.setFromCamera(this.mouse, camera);
    return this.raycaster.ray.intersectPlane(this.plane, this.rayIntersection);
  }

  onMouseMove(event) {
    this.setMouse(event);
    this.castRay();
    this.arrow.lookAt(this.rayIntersection);
    this.arrow.rotateY(-Math.PI / 2);
  }

  publishNavMsg() {
    const { position, rotation } = this.arrow;
    const { publishNavMessages } = this.props;

    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      rotation.z,
    );

    const pose = {
      pose: {
        position: { x: position.x, y: position.y, z: position.z },
        orientation: {
          x: q.x,
          y: q.y,
          z: q.z,
          w: q.w,
        },
      },
    };

    if (this.currentNavTopicType === '/move_base_simple/goal') {
      publishNavMessages(
        { header: { frame_id: 'map' }, ...pose },
        this.currentNavTopicType,
        MESSAGE_TYPE_POSESTAMPED,
      );
    } else {
      const arr = new Array(36).fill(0);
      publishNavMessages(
        { ...pose, covariance: arr },
        this.currentNavTopicType,
        MESSAGE_TYPE_POSECOVARIANCE,
      );
    }
  }

  onMouseDown(event) {
    if (this.controls.enabled || this.transformControlsEnabled) {
      return;
    }

    const { scene } = this.props;
    this.setMouse(event);
    const mousePos = this.castRay();
    if (mousePos) {
      this.arrow.position.set(mousePos.x, mousePos.y, 0);
      scene.add(this.arrow);
      window.addEventListener('mousemove', this.onMouseMove);
    }
  }

  onMouseUp() {
    const { scene } = this.props;

    window.removeEventListener('mousemove', this.onMouseMove);
    scene.remove(this.arrow);

    if (this.currentNavTopicType) {
      this.publishNavMsg();
    }

    this.currentNavTopicType = null;
  }

  disableEditorControls(topicName) {
    this.controls.enabled = false;
    this.currentNavTopicType = topicName;
  }

  enableEditorControls() {
    this.controls.enabled = true;
  }

  initStats() {
    this.stats = new Stats();
    this.stats.showPanel(0);
    this.stats.dom.id = 'viewportStats';
    this.container.current.appendChild(this.stats.dom);
  }

  render() {
    return (
      <div
        ref={this.container}
        onMouseDown={this.onMouseDown}
        onMouseUp={this.onMouseUp}
        className="Panel"
        id="viewport"
      />
    );
  }
}

export default Viewport;
