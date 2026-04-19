---
title: "10 Unique Challenges for Software Engineers in the Broadcast Industry"
date: "2021-01-04"
summary: "Ten things that will surprise you about writing software for live broadcast."
description: "From sub-second latency and 48 Gbps uncompressed 8K feeds to five-nines uptime expectations and a hundred new acronyms: a field guide to the unique challenges of broadcast software engineering."
tags: ["broadcast"]
---

Working in broadcast as a softwareengineer is completely different from other industries. There are unique and surprising challenges you might face.

1. **Low latency**
    
    You must achieve low latency between the involved parties in a live production for effective communication. If you record an interview, you need low latency to have a fluid conversation. Ultimately, the consumer wants to receive live events as they happen.

2. **Reliable video transport**
    
    You must not lose packets, must ensure they are received in order, at a constant bitrate rate and at a constant interval. Achieving this is often at odds with aforementioned low latency, as error correction techniques require time to react or add overhead.

3. **The amount of data**
    
    Encoded sports content at 60 Mbps is common. With 8K we can expect 120 Mbps per feed. Uncompressed 8K video is 48 Gbps. That’s for a single feed! Now check how much your cloud provider of choice is asking for data egress. 

4. **The internet is unreliable**
    
    TCP/IP is a reliable but “slow” protocol. UDP is a fire-and-forget but without any guarantees. The clients are smart, the network is dumb. You’ll painfully notice when packets arrive too slowly or not at all whereas you wouldn’t care as much about a website loading a little bit slower for you once in a while. 

5. **Not everything is HTTP**
    
    Cloud providers can sell you incredible tech. But some assume that all connections are short-lived and follow the request-response paradigm. 24/7 video uses protocols that don’t work that way. You’ll need to come up with designs that allow for updates and failover without interrupting the program.

6. **Compute heavy**
    
    When creating multiple encodings of live content you’ll learn quickly that a single machine alone won’t be able to create many derivatives of a mezzanine input stream. 

7. **Broadcast equipment is picky**
    
    Traditional broadcast equipment is everywhere. Baseband decoders may not function properly if the video packets are received at varying intervals or in bursts. You’ll have to deal with frame rates like 59.94 or 29.97 and interlaced video.

8. **Patents everywhere**
    
    While coming up with potentially novel solutions you’ll have to ensure that you do not infringe one of the many patents in this space. Got a new idea for a video codec? Good luck to you and Godspeed!

9. **Television is always available**
   
    Consumers and customers expect at least uptime guarantees in the range of five 9s and above. Television always works. Approx half of the globe's population has watched the world cup final at roughly the same time! 

10. **Acronyms everywhere**
    
    You’ll have to learn at least 100 new acronyms like SVOD, TVOD, OTT, MVPD, PAT, PMT, PCR, FEC, SCTE, SMPTE, … :)

The media industry is an incredible space to be in right now. We are already in the transition from satellite to IP and there are tons of interesting challenges to solve.