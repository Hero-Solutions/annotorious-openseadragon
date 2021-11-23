import EventEmitter from 'tiny-emitter';
import OpenSeadragon from 'openseadragon';
import { SVG_NAMESPACE, addClass } from '@recogito/annotorious/src/util/SVG';
import DrawingTools from '@recogito/annotorious/src/tools/ToolsRegistry';
import Crosshair from '@recogito/annotorious/src/Crosshair';
import { drawShape, shapeArea } from '@recogito/annotorious/src/selectors';
import { format } from '@recogito/annotorious/src/util/Formatting';
import { isTouchDevice, enableTouchTranslation } from '@recogito/annotorious/src/util/Touch';
import { getSnippet } from './util/ImageSnippet';

export default class OSDAnnotationLayer extends EventEmitter {

  constructor(props) {
    super();

    this.viewer = props.viewer;

    this.readOnly = props.config.readOnly;
    this.headless = props.config.headless;
    this.formatter = props.config.formatter;

    this.disableSelect = false;

    this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');

    if (isTouchDevice()) {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer touch');
      enableTouchTranslation(this.svg);
    } else {
      this.svg.setAttribute('class', 'a9s-annotationlayer a9s-osd-annotationlayer');
    }    

    this.g = document.createElementNS(SVG_NAMESPACE, 'g');
    this.svg.appendChild(this.g);
    
    this.viewer.canvas.appendChild(this.svg);

    this.viewer.addHandler('animation', () => this.resize());
    this.viewer.addHandler('rotate', () => this.resize());
    this.viewer.addHandler('resize', () => this.resize());
    this.viewer.addHandler('flip', () => this.resize());

    const onLoad = () => {
      const { x, y } = this.viewer.world.getItemAt(0).source.dimensions;

      props.env.image = {
        src: this.viewer.world.getItemAt(0).source['@id'] || 
          new URL(this.viewer.world.getItemAt(0).source.url, document.baseURI).href,
        naturalWidth: x,
        naturalHeight: y
      };

      if (props.config.crosshair) {
        this.crosshair = new Crosshair(this.g, x, y);
        addClass(this.svg, 'has-crosshair');
      }

      this.resize();      
    }

    // Store image properties on open (incl. after page change) and on addTiledImage
    this.viewer.addHandler('open', onLoad);
    this.viewer.world.addHandler('add-item', onLoad);

    this.selectedShape = null;

    this.tools = new DrawingTools(this.g, props.config, props.env);
    this._initDrawingMouseTracker();
  }

  /** Initializes the OSD MouseTracker used for drawing **/
  _initDrawingMouseTracker = () => {

    let started = false;

    this.mouseTracker = new OpenSeadragon.MouseTracker({
      element: this.svg,

      pressHandler: evt => {
        if (!this.tools.current.isDrawing)
          this.tools.current.start(evt.originalEvent);
      },

      moveHandler: evt => {
        if (this.tools.current.isDrawing) {
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
          this.tools.current.onMouseMove(x, y, evt.originalEvent);

          if (!started) {
            this.emit('startSelection', { x , y });
            started = true;
          }
        }
      },

      releaseHandler: evt => {
        if (this.tools.current.isDrawing) {
          const { x , y } = this.tools.current.getSVGPoint(evt.originalEvent);
          this.tools.current.onMouseUp(x, y, evt.originalEvent);
        }

        started = false;
      }
    }).setTracking(false);

    this.tools.on('complete', shape => { 
      this.selectShape(shape);
      this.emit('createSelection', shape.annotation);
      this.mouseTracker.setTracking(false);
    });

    // Keep tracker disabled until Shift is held
    document.addEventListener('keydown', evt => {
      if (evt.which === 16 && !this.selectedShape) { // Shift
        this.mouseTracker.setTracking(!this.readOnly);
      }
    });

    document.addEventListener('keyup', evt => {
      if (evt.which === 16 && !this.tools.current.isDrawing) {
        this.mouseTracker.setTracking(false);
      }
    });
  }

  _attachMouseListeners = (shape, annotation) => {
    shape.addEventListener('mouseenter', () => {
      this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom = false;

      if (!this.tools?.current.isDrawing)
        this.emit('mouseEnterAnnotation', annotation, shape);
    });

    shape.addEventListener('mouseleave', () => {
      this.viewer.gestureSettingsByDeviceType('mouse').clickToZoom = true;

      if (!this.tools?.current.isDrawing)
        this.emit('mouseLeaveAnnotation', annotation, shape);
    });

    // Common click/tap handler
    const onClick = () => {
      // Unfortunately, click also fires after drag, which means
      // a new selection on top of this shape will be inerpreted 
      // as click. Identify this case and pervent the default
      // selection action!
      const isSelection = this.selectedShape?.annotation.isSelection;
      if (!isSelection) {
        if (this.disableSelect) {
          this.emit('clickAnnotation', shape.annotation, shape);
        } else {
          this.selectShape(shape)
        }
      }
    }

    shape.addEventListener('click', onClick);
    shape.addEventListener('touchend', onClick);
  }

  addAnnotation = annotation => {
    const shape = drawShape(annotation);
    if(annotation.target.styleClass) {
      shape.setAttribute('class', 'a9s-annotation ' + annotation.target.styleClass);
    } else {
      shape.setAttribute('class', 'a9s-annotation');
    }

    shape.setAttribute('data-id', annotation.id);
    shape.annotation = annotation;

    this._attachMouseListeners(shape, annotation);

    this.g.appendChild(shape);

    if (typeof window.annoIds !== undefined && typeof window.annoIds[annotation.id] !== undefined) {
      var number = window.annoIds[annotation.id];
      var bbox = shape.getBBox();
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      var add = 100;
      if(number >= 10000) {
        add += 100;
      }
      if(number >= 1000) {
        add += 100;
      }
      if(number >= 100) {
        add += 100;
      }
      if(number >= 10) {
        add += 100;
      }
      text.setAttributeNS(null, 'x', bbox.x - 50 - add);
      text.setAttributeNS(null, 'y', bbox.y + 170);

      if (annotation.target.styleClass) {
        text.setAttributeNS(null, 'class', 'annotation-number ' + annotation.target.styleClass);
      } else {
        text.setAttributeNS(null, 'class', 'annotation-number');
      }

      var textNode = document.createTextNode(number);
      text.appendChild(textNode);
      shape.appendChild(text);
    }

    format(shape, annotation, this.formatter);

    this.scaleFormatterElements(shape);
  }

  addDrawingTool = plugin =>
    this.tools.registerTool(plugin);

  addOrUpdateAnnotation = (annotation, previous) => {
    if (this.selectedShape?.annotation === annotation || this.selectedShape?.annotation == previous)
      this.deselect();
  
    if (previous)
      this.removeAnnotation(annotation);

    this.removeAnnotation(annotation);
    this.addAnnotation(annotation);

    // Make sure rendering order is large-to-small
    this.redraw();
  }

  currentScale = () => {
    const containerWidth = this.viewer.viewport.getContainerSize().x;
    const zoom = this.viewer.viewport.getZoom(true);
    return zoom * containerWidth / this.viewer.world.getContentFactor();
  }

  deselect = skipRedraw => {
    this.tools?.current.stop();
    
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;

      if (this.selectedShape.destroy) {
        // Modifiable shape: destroy and re-add the annotation
        this.selectedShape.mouseTracker.destroy();
        this.selectedShape.destroy();

        if (!annotation.isSelection)
          this.addAnnotation(annotation);

          if (!skipRedraw)
            this.redraw();
      }
      
      this.selectedShape = null;
    }
  }

  destroy = () => {
    this.deselect();
    this.mouseTracker.destroy();
    this.svg.parentNode.removeChild(this.svg);
  }

  findShape = annotationOrId => {
    const id = annotationOrId?.id ? annotationOrId.id : annotationOrId;
    return this.g.querySelector(`.a9s-annotation[data-id="${id}"]`);
  }

  fitBounds = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { x, y, width, height } = shape.getBBox(); // SVG element bounds, image coordinates
      const rect = this.viewer.viewport.imageToViewportRectangle(x, y, width, height);
      this.viewer.viewport.fitBounds(rect, immediately);
    }    
  }

  getAnnotations = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    return shapes.map(s => s.annotation);
  }

  getSelected = () => {
    if (this.selectedShape) {
      const { annotation } = this.selectedShape;
      const element = this.selectedShape.element || this.selectedShape;
      return { annotation, element };
    }
  }

  getSelectedImageSnippet = () => {
    if (this.selectedShape) {
      const shape = this.selectedShape.element ?? this.selectedShape;
      return getSnippet(this.viewer, shape);
    }
  }

  init = annotations => {
    // Clear existing
    this.deselect();

    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));
    shapes.forEach(s => this.g.removeChild(s));

    // Add
    annotations.sort((a, b) => shapeArea(b) - shapeArea(a));
    annotations.forEach(this.addAnnotation);
  }

  listDrawingTools = () =>
    this.tools.listTools();

  overrideId = (originalId, forcedId) => {
    // Update SVG shape data attribute
    const shape = this.findShape(originalId);
    shape.setAttribute('data-id', forcedId);

    // Update annotation
    const { annotation } = shape;

    const updated = annotation.clone({ id : forcedId });
    shape.annotation = updated;

    return updated;
  }

  panTo = (annotationOrId, immediately) => {
    const shape = this.findShape(annotationOrId);
    if (shape) {
      const { top, left, width, height } = shape.getBoundingClientRect();

      const x = left + width / 2 + window.scrollX;
      const y = top + height / 2 + window.scrollY;
      const center = this.viewer.viewport.windowToViewportCoordinates(new OpenSeadragon.Point(x, y));

      this.viewer.viewport.panTo(center, immediately);
    }    
  }

  redraw = () => {
    const shapes = Array.from(this.g.querySelectorAll('.a9s-annotation'));

    const annotations = shapes.map(s => s.annotation);
    annotations.sort((a, b) => shapeArea(b) - shapeArea(a));

    // Clear the SVG element
    shapes.forEach(s => this.g.removeChild(s));

    // Redraw
    annotations.forEach(this.addAnnotation);
  }
  
  removeAnnotation = annotationOrId => {
    // Removal won't work if the annotation is currently selected - deselect!
    const id = annotationOrId.type ? annotationOrId.id : annotationOrId;

    if (this.selectedShape?.annotation.id === id)
      this.deselect();
      
    const toRemove = this.findShape(annotationOrId);

    if (toRemove) {
      if (this.selectedShape?.annotation === toRemove.annotation)
        this.deselect();

      if(toRemove.mouseTracker != null) {
        toRemove.mouseTracker.destroy();
      }
      toRemove.parentNode.removeChild(toRemove);
    }
  }

  resize() {
    const flipped = this.viewer.viewport.getFlip();

    const p = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    if (flipped)
      p.x = this.viewer.viewport._containerInnerSize.x - p.x;

    const scaleY = this.currentScale();
    const scaleX = flipped ? - scaleY : scaleY;
    const rotation = this.viewer.viewport.getRotation();

    this.g.setAttribute('transform', `translate(${p.x}, ${p.y}) scale(${scaleX}, ${scaleY}) rotate(${rotation})`);

    this.scaleFormatterElements();

    if (this.selectedShape) {
      if (this.selectedShape.element) { // Editable shape
        this.selectedShape.scaleHandles(1 / scaleY);
        this.emit('viewportChange', this.selectedShape.element);
      } else {
        this.emit('viewportChange', this.selectedShape); 
      }       
    }
  }
  
  scaleFormatterElements = opt_shape => {
    const scale = 1 / this.currentScale();

    if (opt_shape) {
      const el = opt_shape.querySelector('.a9s-formatter-el');
      if (el)
        el.firstChild.setAttribute('transform', `scale(${scale})`);
    } else {
      const elements = Array.from(this.g.querySelectorAll('.a9s-formatter-el'));
      elements.forEach(el =>
        el.firstChild.setAttribute('transform', `scale(${scale})`));
    }
  }

  selectAnnotation = (annotationOrId, skipEvent) => {
    if (this.selectedShape)
      this.deselect();

    const selected = this.findShape(annotationOrId);

    if (selected) {
      this.selectShape(selected, skipEvent);

      const element = this.selectedShape.element ? 
        this.selectedShape.element : this.selectedShape;

      return { annotation: selected.annotation, element };
    } else {
      this.deselect();
    }
  }

  selectShape = (shape, skipEvent) => {
    if (!skipEvent)
      this.emit('clickAnnotation', shape.annotation, shape);
  
      // Don't re-select
    if (this.selectedShape?.annotation === shape?.annotation)
      return;

    // If another shape is currently selected, deselect first
    if (this.selectedShape && this.selectedShape.annotation !== shape.annotation)
      this.deselect(true);

    const { annotation } = shape;

    const readOnly = this.readOnly || annotation.readOnly;

    if (!(readOnly || this.headless)) {
      setTimeout(() => {
        shape.parentNode.removeChild(shape);

        // Fire the event AFTER the original shape was removed. Otherwise,
        // people calling `.getAnnotations()` in the `onSelectAnnotation` 
        // handler will receive a duplicate annotation
        // (See issue https://github.com/recogito/annotorious-openseadragon/issues/63)
        if (!skipEvent)
          this.emit('select', { annotation, element: this.selectedShape.element });
      }, 1);

      const toolForAnnotation = this.tools.forAnnotation(annotation);
      this.selectedShape = toolForAnnotation.createEditableShape(annotation);
      this.selectedShape.scaleHandles(1 / this.currentScale());

      this.scaleFormatterElements(this.selectedShape.element);

      this.selectedShape.element.annotation = annotation;     
      this.selectedShape.element.addEventListener('click', () => {
        this.emit('clickAnnotation', annotation, this.selectedShape.element)
      });

      // Disable normal OSD nav
      const editableShapeMouseTracker = new OpenSeadragon.MouseTracker({
        element: this.svg
      }).setTracking(true);

      // En-/disable OSD nav based on hover status
      this.selectedShape.element.addEventListener('mouseenter', evt =>
        editableShapeMouseTracker.setTracking(true));
  
      this.selectedShape.element.addEventListener('mouseleave', evt =>
        editableShapeMouseTracker.setTracking(false));
      
      this.selectedShape.mouseTracker = editableShapeMouseTracker;
  
      this.selectedShape.on('update', fragment =>
        this.emit('updateTarget', this.selectedShape.element, fragment));
    } else {
      this.selectedShape = shape;

      if (!skipEvent)
        this.emit('select', { annotation, element: shape, skipEvent });   
    }
  }

  setDrawingEnabled = enable =>
    this.mouseTracker?.setTracking(enable && !this.readOnly);

  setDrawingTool = shape => {
    if (this.tools) {
      this.tools.current?.stop();
      this.tools.setCurrent(shape);
    }
  }

  setVisible = visible => {
    if (visible) {
      this.svg.style.display = null;
    } else {
      this.deselect();
      this.svg.style.display = 'none';
    }
  }

}