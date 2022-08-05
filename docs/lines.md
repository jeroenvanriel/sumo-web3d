- We assume that lanes appear ordered in the network file.
- We assume that edge 'E' has opposite edge '-E'.


The lines between lanes are found first, by taking the intersection of each lane with the next.
Next, all lanes for each edge are merged, which allows us to find the lines between opposite edges.
Note that we assume that opposite edges are identified by adding a '-' sign in front of the edge id.
