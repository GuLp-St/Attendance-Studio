import { createContext, useContext, useState, useRef, useEffect } from 'react';
import Modal from '../components/Modal';

const ConfirmContext = createContext();

export const useConfirm = () => useContext(ConfirmContext);

export const ConfirmProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  
  const resolveRef = useRef(null);

  const confirm = (msg) => {
    setMessage(msg);
    setIsOpen(true);
    // Push explicit state
    window.history.pushState({ level: 'confirm' }, '', '#confirm');
    
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const handleAction = (choice) => {
    // Only pop history if we are currently at the 'confirm' level.
    // This prevents popping parent states (like #admin) accidentally.
    if (window.history.state?.level === 'confirm') {
        window.history.back();
    }
    
    setIsOpen(false);
    if (resolveRef.current) {
      resolveRef.current(choice);
      resolveRef.current = null;
    }
  };

  useEffect(() => {
    const handlePopState = (e) => {
      // If we popped back, and the new state is NOT 'confirm', it means we closed the modal
      if (isOpen && e.state?.level !== 'confirm') {
        setIsOpen(false);
        if (resolveRef.current) {
          resolveRef.current(false); // Treat Back button as "No"
          resolveRef.current = null;
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isOpen]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      
      <Modal 
        title="CONFIRMATION" 
        isOpen={isOpen} 
        onClose={() => handleAction(false)} 
        maxWidth="300px"
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            color: '#fff', 
            marginBottom: '20px', 
            fontSize: '1rem', 
            wordBreak: 'break-word', 
            padding: '0 10px' 
          }}>
            {message}
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button 
                className="btn" 
                style={{ borderColor: '#f00', color: '#f00', minWidth: '80px' }} 
                onClick={() => handleAction(true)}
            >
                YES
            </button>
            <button 
                className="btn" 
                style={{ minWidth: '80px' }} 
                onClick={() => handleAction(false)}
            >
                NO
            </button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
};