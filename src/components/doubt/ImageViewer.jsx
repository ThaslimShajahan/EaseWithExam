import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, X, RotateCcw, Maximize2 } from 'lucide-react';

export default function ImageViewer({ src, alt = 'Uploaded image', compact = false }) {
  const [scale,  setScale]  = useState(1);
  const [modal,  setModal]  = useState(false);
  const imgRef = useRef(null);

  const zoom  = (delta) => setScale((s) => Math.max(0.5, Math.min(3, s + delta)));
  const reset = () => setScale(1);

  const ViewerContent = ({ inModal = false }) => (
    <div className={`relative overflow-hidden rounded-xl bg-slate-100 ${inModal ? 'h-full' : ''}`}>
      <div
        className="overflow-auto"
        style={{ maxHeight: inModal ? '75vh' : compact ? 180 : 360 }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className="w-full object-contain transition-transform duration-200 select-none"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
        />
      </div>

      {/* Toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1
                      bg-black/60 backdrop-blur-sm rounded-xl px-2 py-1">
        {[
          { icon: ZoomOut,   action: () => zoom(-0.25), title: 'Zoom out'  },
          { icon: ZoomIn,    action: () => zoom(+0.25), title: 'Zoom in'   },
          { icon: RotateCcw, action: reset,             title: 'Reset zoom'},
        ].map(({ icon: Icon, action, title }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className="h-7 w-7 flex items-center justify-center text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <Icon size={14} />
          </button>
        ))}
        <span className="text-white/60 text-xs px-1">{Math.round(scale * 100)}%</span>
        {!inModal && (
          <button
            onClick={() => setModal(true)}
            title="Fullscreen"
            className="h-7 w-7 flex items-center justify-center text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <ViewerContent />

      {/* Full-screen modal */}
      <AnimatePresence>
        {modal && (
          <motion.div
            className="fixed inset-0 z-[200] bg-black/90 flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex justify-end p-4">
              <button
                onClick={() => { setModal(false); setScale(1); }}
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <img
                src={src}
                alt={alt}
                className="max-w-full mx-auto object-contain transition-transform duration-200"
                style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
              />
            </div>
            <div className="flex justify-center gap-2 p-4">
              {[
                { icon: ZoomOut,   action: () => zoom(-0.25) },
                { icon: ZoomIn,    action: () => zoom(+0.25) },
                { icon: RotateCcw, action: reset             },
              ].map(({ icon: Icon, action }, i) => (
                <button
                  key={i}
                  onClick={action}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
