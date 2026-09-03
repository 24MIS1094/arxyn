import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { Send, X, MessageSquare, ListMusic, Check } from 'lucide-react';

export function ChatPanel({ roomId, userId, members, isOpen, close, notify, onUnreadChange }: { roomId: string, userId: string, members: any[], isOpen: boolean, close: () => void, notify: (msg: string) => void, onUnreadChange?: (count: number) => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unread, setUnread] = useState(0);
  const [, setTick] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getMemberName = (id: string) => {
    const member = members.find(m => m.user_id === id);
    return member?.display_name || 'User';
  };

  useEffect(() => {
    if (isOpen) {
      setUnread(0);
      onUnreadChange?.(0);
    }
  }, [isOpen, onUnreadChange]);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    
    // Fetch initial messages
    const fetchMessages = async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await client
        .from('room_messages')
        .select('*')
        .eq('room_id', roomId)
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: true })
        .limit(50);
        
      if (!error && data) {
        setMessages(data);
      }
    };
    
    fetchMessages();

    // Subscribe to new messages
    const channel = client
      .channel(`chat:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_messages',
        filter: `room_id=eq.${roomId}`
      }, (payload) => {
        setMessages(prev => {
          if (prev.find(m => m.id === payload.new.id)) return prev;
          
          if (payload.new.user_id !== userId) {
            if (!isOpenRef.current) {
              setUnread(u => {
                const count = u + 1;
                onUnreadChange?.(count);
                return count;
              });
            }
            notify(`💬 New message from ${payload.new.username || 'Friend'}`);
          }
          return [...prev, payload.new];
        });
      })
      .subscribe((status, err) => {
        console.log(`Chat subscription status: ${status}`, err || '');
      });

    return () => {
      client.removeChannel(channel);
    };
  }, [roomId, userId, onUnreadChange, notify]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = supabase;
    if (!newMessage.trim() || !client) return;
    
    const text = newMessage.trim();
    setNewMessage('');
    
    const { error } = await client.from('room_messages').insert({
      room_id: roomId,
      user_id: userId,
      username: getMemberName(userId),
      message: text
    });
    
    if (error) {
      console.error("Failed to send message:", error);
      // optionally add it back to input if failed
      setNewMessage(text);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const validMessages = messages.filter(m => now - new Date(m.created_at).getTime() < ONE_HOUR);

  return (
    <div className="side-panel" style={{ display: isOpen ? 'flex' : 'none' }}>
      <div className="side-panel-header">
        <h3><MessageSquare size={20}/> Room Chat</h3>
        <button onClick={close} className="icon-button"><X size={20} /></button>
      </div>
      <div className="side-panel-body">
        {validMessages.map(msg => {
          const isSelf = msg.user_id === userId;
          return (
            <div key={msg.id} className={`chat-message ${isSelf ? 'self' : 'other'}`}>
              {!isSelf && <span className="chat-message-sender">{getMemberName(msg.user_id)}</span>}
              <div className="chat-message-bubble">
                {msg.message}
                <span className="chat-message-time">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={sendMessage} className="chat-input-area">
        <input 
          type="text" 
          value={newMessage} 
          onChange={e => setNewMessage(e.target.value)}
          placeholder="Type a message..."
        />
        <button type="submit" disabled={!newMessage.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

export function RequestsPanel({ roomId, isHost, userId, isOpen, close, notify, onPendingChange }: { roomId: string, isHost: boolean, userId: string, isOpen: boolean, close: () => void, notify: (msg: string) => void, onPendingChange?: (count: number) => void }) {
  const [requests, setRequests] = useState<any[]>([]);

  useEffect(() => {
    onPendingChange?.(requests.length);
  }, [requests.length, onPendingChange]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    
    const fetchRequests = async () => {
      const { data, error } = await client
        .from('song_requests')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        setRequests(data);
      }
    };
    
    fetchRequests();

    const channel = client
      .channel(`requests:${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'song_requests',
        filter: `room_id=eq.${roomId}`
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (payload.new.status === 'pending') {
            setRequests(prev => {
              if (prev.find(r => r.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            });
            if (isHost && payload.new.requester_id !== userId) {
              notify(`🎵 New Song Request: ${payload.new.song_title} by ${payload.new.requester_name || 'Friend'}`);
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          if (payload.new.status !== 'pending') {
            setRequests(prev => prev.filter(r => r.id !== payload.new.id));
          }
        } else if (payload.eventType === 'DELETE') {
          setRequests(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe((status, err) => {
        console.log(`Requests subscription status: ${status}`, err || '');
      });

    return () => {
      client.removeChannel(channel);
    };
  }, [roomId, isHost, userId, notify]);

  const acceptRequest = async (request: any) => {
    const client = supabase;
    if (!client) return;
    
    // Check if the request is already accepted to prevent duplicates (double-click prevention)
    if (request.status !== 'pending') return;
    
    // Optimistically hide the request
    setRequests(prev => prev.filter(r => r.id !== request.id));

    const { data: qData } = await client
      .from('queue_items')
      .select('position')
      .eq('room_id', roomId)
      .order('position', { ascending: false })
      .limit(1);
      
    const pos = qData && qData.length > 0 ? qData[0].position + 1 : 1;

    const { error: qError } = await client.from('queue_items').insert({
      room_id: roomId,
      media_id: request.video_id,
      title: request.song_title,
      artist: request.artist,
      artwork_url: request.thumbnail,
      requested_by: request.requester_id,
      position: pos,
      source_type: 'youtube'
    });

    if (qError) {
      notify("Failed to add to queue");
      // Revert if error
      setRequests(prev => [request, ...prev]);
      return;
    }

    const { error: updateError } = await client.from('song_requests').update({ status: 'accepted' }).eq('id', request.id);
    if (updateError) {
      console.error('Request action failed (Accept)', {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });
      notify("Failed to accept request");
      setRequests(prev => [request, ...prev]); // Revert on failure
      return;
    }
    notify("Song added to queue!");
  };

  const rejectRequest = async (request: any) => {
    const client = supabase;
    if (!client) return;
    
    // Check if the request is already accepted to prevent duplicates (double-click prevention)
    if (request.status !== 'pending') return;

    // Optimistically hide the request
    setRequests(prev => prev.filter(r => r.id !== request.id));
    
    const { error: updateError } = await client.from('song_requests').update({ status: 'rejected' }).eq('id', request.id);
    if (updateError) {
      console.error('Request action failed (Reject)', {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });
      notify("Failed to reject request");
      setRequests(prev => [request, ...prev]); // Revert on failure
    }
  };

  return (
    <div className="side-panel" style={{ display: isOpen ? 'flex' : 'none' }}>
      <div className="side-panel-header">
        <h3><ListMusic size={20}/> Song Requests</h3>
        <button onClick={close} className="icon-button"><X size={20} /></button>
      </div>
      <div className="side-panel-body">
        {requests.length === 0 && (
          <div style={{ textAlign: 'center', opacity: 0.5, marginTop: 40 }}>No pending requests</div>
        )}
        {requests.map(req => (
          <div key={req.id} className="request-item">
            <div className="request-item-info">
              {req.thumbnail ? (
                <img src={req.thumbnail} className="request-item-art" />
              ) : (
                <div className="request-item-art" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎵</div>
              )}
              <div className="request-item-text">
                <h4>{req.song_title}</h4>
                <p>{req.artist || 'Unknown'} • {req.requester_name || 'Friend'}</p>
              </div>
            </div>
            {isHost ? (
              <div className="request-actions">
                <button className="request-btn-accept" onClick={() => acceptRequest(req)}>
                  <Check size={16} /> Accept
                </button>
                <button className="request-btn-reject" onClick={() => rejectRequest(req)}>
                  <X size={16} /> Reject
                </button>
              </div>
            ) : (
              <div className="request-pending-badge">
                Pending Host Approval
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
